const $ = (id) => document.getElementById(id);

export class PeerLanDialog {
  constructor(show, createGuest) {
    this.show = show; this.createGuest = createGuest;
    this.dialog = $('peer-lan-dialog'); this.revision = 0;
    $('peer-lan-host-form').addEventListener('submit', event => { event.preventDefault(); void this.accept(); });
    $('peer-lan-guest-form').addEventListener('submit', event => { event.preventDefault(); void this.answer(); });
    $('peer-lan-new-invite').addEventListener('click', () => { this.host?.cancelInvite(); void this.invite(); });
    $('peer-lan-copy-link').addEventListener('click', () => this.copy($('peer-lan-link'), this.inviteLink));
    $('peer-lan-copy-offer').addEventListener('click', () => this.copy($('peer-lan-link'), this.inviteCode));
    $('peer-lan-copy-answer').addEventListener('click', () => this.copy($('peer-lan-response')));
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return;
      this.revision++;
      if (this.guest && !this.guest.joined) this.guest.close();
      this.host = this.guest = null; this.inviteLink = this.inviteCode = '';
      for (const id of ['peer-lan-link', 'peer-lan-answer', 'peer-lan-offer', 'peer-lan-response']) $(id).value = '';
    });
  }

  status(text, error = false) {
    const status = $('peer-lan-status'); status.textContent = text; status.classList.toggle('offline', error);
  }

  async copy(field, text = field.value) {
    if (!text) return;
    const revision = this.revision;
    try {
      await navigator.clipboard.writeText(text);
      if (revision === this.revision) this.status('복사했습니다. 함께 플레이할 친구에게만 보내 주세요.');
    } catch {
      if (revision !== this.revision) return;
      field.value = text; field.focus(); field.select(); this.status('자동 복사를 할 수 없습니다. 선택된 내용을 직접 복사해 주세요.', true);
    }
  }

  openHost(connection) {
    this.host = connection; this.revision++;
    $('peer-lan-title').textContent = 'LAN 친구 초대';
    $('peer-lan-host-form').hidden = false; $('peer-lan-guest-form').hidden = true;
    this.show(); void this.invite();
  }

  openGuest(invite = '') {
    this.host = null; this.revision++;
    $('peer-lan-title').textContent = 'LAN 초대로 참가';
    $('peer-lan-host-form').hidden = true; $('peer-lan-guest-form').hidden = false;
    $('peer-lan-offer').value = invite; $('peer-lan-response').value = '';
    $('peer-lan-response-panel').hidden = true; $('peer-lan-make-answer').disabled = false;
    this.status('같은 Wi-Fi 또는 유선망에서 연결하세요. 브라우저가 로컬 네트워크 접근을 요청하면 허용해 주세요.');
    this.show();
  }

  hostBusy(value) {
    $('peer-lan-new-invite').disabled = value;
    for (const id of ['peer-lan-copy-link', 'peer-lan-copy-offer', 'peer-lan-connect']) $(id).disabled = value || !this.inviteCode;
  }

  async invite() {
    const revision = ++this.revision;
    this.inviteLink = this.inviteCode = ''; $('peer-lan-link').value = ''; $('peer-lan-answer').value = '';
    this.hostBusy(true); this.status('초대 준비 중입니다. 로컬 네트워크 접근을 요청하면 허용해 주세요.');
    try {
      const token = await this.host.makeInvite();
      if (revision !== this.revision) return;
      const url = new URL('./', import.meta.url); url.hash = `lan=${token}`;
      this.inviteCode = token; this.inviteLink = $('peer-lan-link').value = url.href;
      this.status('초대 링크나 코드를 보내고 친구의 응답을 아래에 붙여넣으세요. 초대는 한 명이 사용하며 생성 후 5분 동안 유효합니다.');
    } catch (error) {
      if (revision === this.revision) this.status(error.message, true);
    } finally { if (revision === this.revision) this.hostBusy(false); }
  }

  async accept() {
    const revision = ++this.revision;
    this.hostBusy(true); this.status('친구와 직접 연결하는 중입니다…');
    try {
      await this.host.acceptAnswer($('peer-lan-answer').value);
      if (revision !== this.revision) return;
      this.inviteLink = this.inviteCode = ''; $('peer-lan-link').value = ''; $('peer-lan-answer').value = '';
      this.status('직접 연결했습니다. 다른 친구를 부르려면 새 초대를 만들어 주세요.');
    } catch (error) {
      if (revision === this.revision) this.status(error.message, true);
    } finally { if (revision === this.revision) this.hostBusy(false); }
  }

  async answer() {
    const revision = ++this.revision;
    const button = $('peer-lan-make-answer');
    button.disabled = true; $('peer-lan-response-panel').hidden = true;
    this.status('응답 코드를 만드는 중입니다…');
    try {
      this.guest?.close();
      const guest = this.guest = this.createGuest();
      guest.addEventListener('close', event => {
        if (revision !== this.revision) return;
        button.disabled = false; $('peer-lan-response').value = ''; $('peer-lan-response-panel').hidden = true;
        if (event.reason) this.status(event.reason, true);
      }, { once: true });
      const response = await guest.answerInvite($('peer-lan-offer').value);
      if (revision !== this.revision || guest.readyState === 3) return;
      $('peer-lan-response').value = response; $('peer-lan-response-panel').hidden = false;
      this.status('응답 코드를 방장에게 보내세요. 방장이 붙여넣을 때까지 이 탭을 열어 두세요.');
    } catch (error) {
      if (revision !== this.revision) return;
      this.guest?.close(); button.disabled = false; this.status(error.message, true);
    }
  }
}
