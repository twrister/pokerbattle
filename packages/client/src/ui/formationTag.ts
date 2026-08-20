import { getExclusiveFormationUnitTag, type CardFormation, type FormationDraft } from '@pb/sim';

/** 单兵种且配置了标签时，在按钮右下角挂角标。 */
export function appendFormationTag(
  button: HTMLElement,
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): void {
  const text = getExclusiveFormationUnitTag(formation);
  if (!text) return;
  const badge = document.createElement('span');
  badge.className = 'formation-tag';
  badge.textContent = text;
  button.appendChild(badge);
}

/** 缩略图缺失改用文字时，避免 textContent 清掉角标和炸弹伤害标。 */
export function applyFormationNameFallback(button: HTMLElement, name: string): void {
  const overlays = [...button.querySelectorAll('.formation-tag, .formation-bomb-damage')];
  button.replaceChildren();
  button.append(name);
  for (const overlay of overlays) button.appendChild(overlay);
}
