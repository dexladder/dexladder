"""Guard against reintroducing launch covers or replacing user intent with timers."""
from pathlib import Path
import sys
html=Path(sys.argv[1] if len(sys.argv)>1 else 'dist/index.html').read_text()
assert 'nvVeilAuto' not in html, 'Retired full-screen eight-second launch veil is present'
assert 'S.tourDone||setTimeout(()=>{S.tourDone||document.hidden||window.DLXW||startTour()},1600)' not in html, 'Tour auto-starts during first load'
assert html.count('data-dl-guide-start')==1, 'Guided learning needs one visible entry point'
assert 'function startTour(){' in html, 'Existing explicit tour functionality lost'
print('PASS: no launch veil or timed tour; visible guided lesson and explicit tour preserved')
