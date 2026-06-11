const drawView = document.getElementById('draw-view')
const rulesView = document.getElementById('rules-view')
const tabDraw = document.getElementById('tab-draw')
const tabRules = document.getElementById('tab-rules')
const saveTileBtn = document.getElementById('save-tile')
const saveRulesBtn = document.getElementById('save-rules')

function showTab(tab) {
  const draw = tab === 'draw'
  drawView.style.display = draw ? 'flex' : 'none'
  rulesView.style.display = draw ? 'none' : 'flex'
  tabDraw.classList.toggle('active', draw)
  tabRules.classList.toggle('active', !draw)
  saveTileBtn.style.display = draw ? '' : 'none'
  saveRulesBtn.style.display = draw ? 'none' : ''
}
tabDraw.addEventListener('click', () => showTab('draw'))
tabRules.addEventListener('click', () => showTab('rules'))
showTab('draw')
