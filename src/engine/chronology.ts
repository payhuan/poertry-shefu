const periods = [
  ['先秦', '商', '周', '春秋', '战国'], ['秦'], ['西汉', '两汉', '汉'], ['东汉'],
  ['三国', '曹魏', '魏', '蜀汉', '孙吴'], ['西晋', '晋', '魏晋'], ['东晋'],
  ['南北朝', '六朝', '北魏', '北齐', '北周', '南朝', '北朝'], ['隋'],
  ['唐', '初唐', '盛唐', '中唐', '晚唐'], ['五代', '南唐', '后梁', '后唐', '后晋', '后汉', '后周'],
  ['辽'], ['宋', '北宋'], ['南宋'], ['金'], ['元'], ['明'], ['清'],
  ['近现代', '民国'], ['现代'], ['当代'],
]
const rank = new Map(periods.flatMap((names, index) => names.map(name => [name, index] as const)))

export function dynastyOrder(dynasty: string): number {
  const original = rank.get(dynasty.trim())
  if (original !== undefined) return original
  const label = dynasty.trim().replace(/(?:朝|代)$/u, '')
  const exact = rank.get(label)
  if (exact !== undefined) return exact
  // Composite labels such as 宋末元初 use their earliest explicitly named period.
  const matches = [...rank].filter(([name]) => name.length > 1 && label.includes(name))
  const common = ['唐', '宋', '金', '元', '明', '清'].filter(name => label.includes(name)).map(name => rank.get(name)!)
  return Math.min(...matches.map(([, order]) => order), ...common, Number.POSITIVE_INFINITY)
}
