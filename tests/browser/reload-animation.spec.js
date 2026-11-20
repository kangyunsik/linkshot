import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('each firearm drives visible reload pieces and restores the bind pose when cancelled', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /THREE|shader/i.test(message.text())) errors.push(message.text()); });
  await page.route('**/app.js', route => route.fulfill({ contentType:'text/javascript', body:'' })); await page.goto('/');
  const checks = await page.evaluate(async () => {
    const [{ WeaponModels,disposeModel },{ EQUIPMENT },{ applyViewmodelReload }] = await Promise.all([import('/weapon-model.js'),import('/shared/catalog.js'),import('/viewmodel-reload.js')]);
    const models = new WeaponModels(), result = [];
    for (const weapon of EQUIPMENT) {
      const gun = models.create(weapon.id,'standard',true,'field','nari',true), rig = gun.userData.reload;
      if (weapon.melee) { result.push({ id:weapon.id, noRig: !rig }); disposeModel(gun); continue; }
      const base = [rig.arm,...rig.rest.map(([part]) => part)];
      gun.updateMatrixWorld(true);
      const neutral = base.map(part => part.matrixWorld.clone()), parts = {}, openHand = rig.palm.geometry;
      let shellFrames = 0, handMoved = false, fingersClosed = false, boltMoved = false, slideMoved = false, transformsFinite = true;
      for (let i = 0; i < 80; i++) {
        applyViewmodelReload(gun,weapon,(i+.5)/80,0); gun.updateMatrixWorld(true);
        if (rig.magazine && rig.magazine.position.lengthSq() > .001) parts.out = true;
        if (rig.fresh?.visible) parts.in = true;
        if (rig.pump && rig.pump.position.z >= -.37) parts.pump = true;
        if (rig.breakAction?.rotation.x < -.7) parts.open = true;
        if (rig.feedCover?.rotation.x < -.7 && rig.belt.visible && rig.belt.position.y > .05) parts.belt = true;
        if (rig.rounds?.some(round => round.visible)) shellFrames++;
        handMoved ||= rig.arm.position.distanceToSquared(rig.handPosition) > .015;
        fingersClosed ||= rig.palm.geometry !== openHand;
        slideMoved ||= rig.slide?.position.z > .045;
        boltMoved ||= rig.bolt?.position.z > .15;
        transformsFinite &&= base.every(part => part.matrixWorld.elements.every(Number.isFinite));
      }
      applyViewmodelReload(gun,weapon,null,0); gun.updateMatrixWorld(true);
      const back = !rig.extras.visible && rig.palm.geometry === openHand && base.every((part,i) => part.visible && part.matrixWorld.elements.every((v,j) => Math.abs(v-neutral[i].elements[j]) < 1e-8));
      result.push({ id:weapon.id,kind:rig.kind,parts,shellFrames,handMoved,fingersClosed,slideMoved:Boolean(slideMoved),boltMoved:Boolean(boltMoved),transformsFinite,back });
      disposeModel(gun);
    }
    models.dispose(); return result;
  });
  for (const check of checks) {
    if (check.id === 'knife') { expect(check.noRig).toBe(true); continue; }
    expect(check.transformsFinite && check.handMoved && check.back, JSON.stringify(check)).toBe(true);
    if (['shell','break','belt','top'].includes(check.kind)) expect(check.fingersClosed,check.id).toBe(true);
    if (check.kind === 'magazine' || check.kind === 'top' || check.kind === 'belt') expect(check.parts.out && check.parts.in, check.id).toBe(true);
    if (check.kind === 'shell') expect(check.parts.pump && check.shellFrames > 25, check.id).toBe(true);
    if (check.kind === 'break') expect(check.parts.open && check.shellFrames > 25, check.id).toBe(true);
    if (check.kind === 'belt') expect(check.parts.belt, check.id).toBe(true);
    if (['pistol','glock18c','deagle'].includes(check.id)) expect(check.slideMoved, check.id).toBe(true);
    if (['sniper','awp','m82'].includes(check.id)) expect(check.boltMoved, check.id).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('in-game shell props and HUD seek to the server deadline without changing ammunition, then clear on completion or switch', async ({ page }) => {
  await page.setViewportSize({ width:1366,height:768 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /THREE|shader/i.test(message.text())) errors.push(message.text()); });
  await page.route('**/app.js', route => route.fulfill({ contentType:'text/javascript',body:'' })); await page.goto('/');
  try {
    const result = await page.evaluate(async () => {
      const [{ FPSGame },{ Room },{ getWeapon },{ viewmodelHipOffset },{ reloadFraming }] = await Promise.all([
        import('/game.js'),import('/shared/simulation.js'),import('/shared/catalog.js'),import('/viewmodel-renderer.js'),import('/reload-time.js'),
      ]);
      const previous = Date.now(); let now = previous, sounds = 0, stopped = 0;
      const room = new Room('FIELD', { bots:0, mapId:'foundry', clock: () => now });
      const player = room.addPlayer('viewer','VIEWER',false,{ weaponId:'shotgun',characterId:'rhea' });
      Object.assign(player,{ x:24,y:0,z:10,yaw:0,pitch:0,protectedUntil:0,ammo:5,switchUntil:0 });
      for (const [i,characterId] of ['nari','jin','rhea'].entries()) {
        const peer = room.addPlayer(characterId,characterId.toUpperCase(),false,{ characterId });
        Object.assign(peer,{x:22.6+i*1.39, y:0, z:6.9+i*.09, yaw:Math.PI+(i-1)*.2, protectedUntil:0});
      }
      document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
      const game = new FPSGame({
        canvas:document.getElementById('game-canvas'),minimap:document.getElementById('minimap'),mapId:'foundry',
        settings:{quality:'low',sensitivity:1,fov:82,volume:0},audio:{step(){},reload(){sounds++;},stopReload(){stopped++;}},send(){},onMenu(){},onFatal(message){throw new Error(message);},
        weaponId:'shotgun',characterId:'rhea',
      });
      window.__reloadFixture = game;
      Object.defineProperty(game,'serverNow',{ get: () => now });
      game.applySnapshot(room.snapshot(),player.id); await game.prepareGraphics();
      const ammoBefore = player.ammo, weapon = getWeapon(player.weaponId), duration = weapon.reloadSeconds * 1000;
      cancelAnimationFrame(game.frameId); game.switchAnimation = 0;
      const started = room.startReload(player,now);
      const deadline = player.reloadUntil;
      const frame = () => { const at = performance.now(); game.previousFrame = at - 44; game.animate(at); cancelAnimationFrame(game.frameId); };
      now += duration * .29; game.applySnapshot(room.snapshot(),player.id);
      const props = game.activeModel.userData.reload, indicator = document.getElementById('reload-indicator');
      const shotBase = viewmodelHipOffset(weapon), offset = reloadFraming(.29,weapon);
      game.weapon.position.set(shotBase.x+offset.x,shotBase.y+offset.y,shotBase.z+offset.z);
      frame();
      const mid = { shell:props.extras.visible && props.rounds[0].visible, ammo:player.ammo, deadline:player.reloadUntil,
        gauge:parseFloat(indicator.style.getPropertyValue('--reload-progress')), actors:game.remote.size, sound:sounds };
      const screenshot = () => { game.renderFrame(); return game.renderer.domElement.toDataURL('image/png').split(',')[1]; };
      const png = screenshot();
      now = deadline + 2; room.tick(1/60); game.applySnapshot(room.snapshot(),player.id); frame();
      const after = { ammo:player.ammo, cleared:!props.extras.visible && indicator.hidden, stopped:stopped > 0 };
      player.ammo = 4; room.startReload(player,now); now += duration * .3; game.applySnapshot(room.snapshot(),player.id); frame();
      game.activateWeapon('pistol'); const switched = !props.extras.visible && !props.active;
      return { started,ammoBefore,magazine:weapon.magazine,deadline,mid,after,switched,png };
    });
    expect(result.started).toBe(true);
    expect(result.mid).toMatchObject({ shell:true,ammo:result.ammoBefore,deadline:result.deadline,actors:3,sound:1 });
    expect(result.mid.gauge).toBeCloseTo(29,3);
    expect(result.after).toEqual({ ammo:result.magazine,cleared:true,stopped:true }); expect(result.switched).toBe(true);
    // Canvas capture is the actual game renderer, not an asset proxy.
    await mkdir('artifacts',{recursive:true});
    await writeFile('artifacts/field-jackets-gameplay.png',Buffer.from(result.png,'base64'));
    expect(errors).toEqual([]);
  } finally { await page.evaluate(() => window.__reloadFixture?.dispose()); }
});
