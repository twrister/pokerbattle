import {
  getFuseBombTypeId,
  isFuseBombFormation,
  resolveFuseBombDamage,
  toFloat,
  UNIT_CONFIGS,
  type CardFormation,
  type PlayingCard,
} from '@pb/sim';

/**
 * 引信炸弹按钮上展示的爆炸伤害：阵型覆盖优先，缺档回落单位默认伤害。
 * 非炸弹阵型返回 null。
 */
export function fuseBombDisplayDamage(
  formation: CardFormation,
  cards: readonly PlayingCard[],
): number | null {
  if (!isFuseBombFormation(formation)) return null;
  const override = resolveFuseBombDamage(formation, cards);
  if (override !== undefined) return Math.round(toFloat(override));
  const typeId = getFuseBombTypeId(formation);
  if (!typeId) return null;
  return Math.round(toFloat(UNIT_CONFIGS[typeId].damage));
}

/** 仅引信炸弹阵型在按钮上挂爆炸底图与红色伤害数字。 */
export function appendFormationBombDamage(
  button: HTMLElement,
  formation: CardFormation,
  cards: readonly PlayingCard[],
): void {
  const damage = fuseBombDisplayDamage(formation, cards);
  if (damage === null) return;
  const badge = document.createElement('span');
  badge.className = 'formation-bomb-damage';
  badge.textContent = String(damage);
  button.appendChild(badge);
}

/** 读屏文案在原说明后补爆炸伤害。 */
export function withBombDamageAriaLabel(base: string, damage: number | null): string {
  return damage === null ? base : `${base}，爆炸伤害 ${damage}`;
}
