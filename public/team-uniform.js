import { TEAM_UNIFORMS } from '/shared/teams.js';

export function applyViewmodelUniform(model, teamId) {
  const palette = Object.hasOwn(TEAM_UNIFORMS,teamId) ? TEAM_UNIFORMS[teamId] : null;
  model.traverse((object) => {
    for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) {
      if (!['view-sleeve-fabric', 'view-cuff'].includes(material.name)) continue;
      material.userData.originalUniformColor ||= material.color.clone();
      if (palette) material.color.set(material.name === 'view-sleeve-fabric' ? palette.suit : palette.dark);
      else material.color.copy(material.userData.originalUniformColor);
    }
  });
  model.userData.teamId = palette ? teamId : null;
}
