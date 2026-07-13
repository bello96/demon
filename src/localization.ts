interface TranslationStrings {
  [key: string]: string
  title: string
  instructions: string
  hint: string
  start: string
  died: string
  respawn: string
  escaped: string
  playAgain: string
  interact: string
  switchInRoom: string
  switchNotFound: string
  doorLocked: string
  gotKey: string
  gotRadar: string
  selectLevel: string
  levelLabel: string
  lockedTip: string
  nextLevel: string
  backToSelect: string
  allCleared: string
}

const translations: Record<string, TranslationStrings> = {
  zh: {
    title: '方块噩梦',
    instructions: 'WASD 移动 | SPACE 跳跃 | SHIFT 奔跑 | E 躲藏/交互 | F 手电筒',
    hint: '快点找到逃生的门，避免被幽灵抓到',
    start: '开始游戏',
    died: '你死了',
    respawn: '重生',
    escaped: '逃脱成功',
    playAgain: '再玩一次',
    interact: '按 E 键交互',
    switchInRoom: '灯光开关在 {id} 号房间',
    switchNotFound: '未找到开关',
    doorLocked: '门锁住了 (需要钥匙)',
    gotKey: '[已获得钥匙，赶快找到逃生的门吧] ',
    gotRadar: '[已获得雷达，可在小地图查看幽灵位置] ',
    selectLevel: '选择关卡',
    levelLabel: '第 {n} 关',
    lockedTip: '未解锁',
    nextLevel: '进入下一关',
    backToSelect: '返回选关',
    allCleared: '全部通关！'
  },
  en: {
    title: 'Blocky Horror',
    instructions: 'WASD Move | SPACE Jump | SHIFT Run | E Hide/Interact | F Flashlight',
    hint: 'Find the exit door quickly, avoid the ghost.',
    start: 'Start Game',
    died: 'You Died',
    respawn: 'Respawn',
    escaped: 'Escaped Successfully',
    playAgain: 'Play Again',
    interact: 'Press E to Interact',
    switchInRoom: 'Light switch is in room {id}',
    switchNotFound: 'Switch not found',
    doorLocked: 'Door locked (Key required)',
    gotKey: '[Key obtained, find the exit!] ',
    gotRadar: '[Radar obtained, ghost visible on minimap] ',
    selectLevel: 'Select Level',
    levelLabel: 'Level {n}',
    lockedTip: 'Locked',
    nextLevel: 'Next Level',
    backToSelect: 'Back to Levels',
    allCleared: 'All Levels Cleared!'
  }
}

let currentLang = 'en'

export function initLocalization(): void {
  const lang = navigator.language
  currentLang = lang.startsWith('zh') ? 'zh' : 'en'
  updateDOM()
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  let str = translations[currentLang]?.[key] ?? key
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(`{${k}}`, String(v))
  }
  return str
}

function updateDOM(): void {
  const map: Record<string, string> = {
    'title-text': 'title',
    'instructions-text': 'instructions',
    'hint-text': 'hint',
    'btn-start': 'start',
    'died-text': 'died',
    'respawn-btn': 'respawn',
    'escaped-text': 'escaped',
    'interaction-msg': 'interact',
    'game-hint-text': 'hint',
    'level-select-title': 'selectLevel',
    'next-level-btn': 'nextLevel',
    'win-menu-btn': 'backToSelect',
    'dead-menu-btn': 'backToSelect',
    'btn-menu': 'backToSelect'
  }

  for (const [id, key] of Object.entries(map)) {
    const el = document.getElementById(id)
    if (el) {
      el.innerText = t(key)
    }
  }
}
