"""UI-Smoke-Test: echte App, Google-Login und Sheets-API gemockt."""
import json, sys, threading, http.server, functools, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1])
CHART = sys.argv[2] if len(sys.argv) > 2 else None  # lokale chart.umd.js (Sandbox ohne CDN)
d = lambda iso: (__import__('datetime').date.fromisoformat(iso) - __import__('datetime').date(1899,12,30)).days

tabs = {
 'Assets': [['asset_id','instrument','konto_id','klasse','risiko','bezeichnung','isin','einheit','aktiv']] + [
   ['AMUNDI_PAB','AMUNDI_PAB','FLATEX','ETF','Mäßig','Amundi MSCI World SRI Climate PAB','IE000Y77LGG9','Stk',True],
   ['IWDA','IWDA','FLATEX','ETF','Mäßig','iShares Core MSCI World','IE00B4L5Y983','Stk',True],
   ['UBS_SRI','UBS_SRI','FLATEX','ETF','Mäßig','UBS MSCI World Socially Resp.','LU0629459743','Stk',True],
   ['BTC_KRAKEN','BTC','KRAKEN','Krypto','Unsicher','Bitcoin (Kraken)','','BTC',True],
   ['BTC_LEDGER','BTC','LEDGER','Krypto','Unsicher','Bitcoin (Ledger)','','BTC',True],
   ['GOLD','XAU','PHYSISCH','Edelmetall','Sicher','Gold 10 × 1 oz','','oz',True]],
 'Kurse': [['instrument','gf_ticker','waehrung','kurs_roh','fx_eur','kurs_live_eur','kurs_manuell_eur','kurs_eur','quelle','hist_symbol'],
   ['AMUNDI_PAB','','EUR',122.16,1,122.16,125,122.16,'live','yahoo:WSRI.PA'],
   ['IWDA','','EUR',130.48,1,130.48,131,130.48,'live','yahoo:IWDA.AS'],
   ['UBS_SRI','','CHF',171.6,1.0786,185.09,188,185.09,'live','yahoo:WSRUSA.SW'],
   ['BTC','','EUR',73661,1,73661,74105,73661,'live','coingecko:bitcoin'],
   ['XAU','','EUR','',1,'',3670.54,3670.54,'manuell','yahoo:GC=F (USD)']],
 'Transaktionen': [['tx_id','datum','asset_id','typ','menge','kurs_eur','betrag_eur','gebuehr_eur','quelle','notiz'],
   ['T0001',d('2026-10-11'),'AMUNDI_PAB','Basis',165,125.06,20634.41,0,'',''],
   ['T0002',d('2026-10-11'),'IWDA','Basis',46,112.04,5153.85,0,'',''],
   ['T0004',d('2026-10-11'),'UBS_SRI','Basis',4.908486,177.7,872.25,0,'',''],
   ['T0013',d('2026-10-15'),'UBS_SRI','Sparplan',1.062403,185.43,200,3,'',''],
   ['T0007',d('2026-10-11'),'BTC_KRAKEN','Basis',0.12353,101001.3,12476.69,0,'',''],
   ['T0009',d('2026-10-11'),'BTC_LEDGER','Basis',1.64661,'','','','',''],
   ['T0011',d('2026-10-11'),'GOLD','Basis',10,'','','','','']],
 'Sparplaene': [['plan_id','asset_id','isin','betrag_eur','tag','gebuehr_eur','aktiv','notiz'],
   ['SP1','UBS_SRI','',200,15,3,True,'läuft seit 2021'],['SP2','AMUNDI_PAB','',100,15,0,False,'geplant']],
 'Konten': [['konto_id','bezeichnung','typ','risiko','hinweis'],['FLATEX','Flatex Depot','Depot','',''],['KRAKEN','Kraken Krypto','Börse','',''],
   ['LEDGER','Ledger Wallet','Wallet','',''],['PHYSISCH','Edelmetall physisch','Physisch','',''],['KRAKEN_EUR','Kraken EUR','Cash','Sicher',''],['N26','N26','Cash','Sicher','']],
 'Salden': [['datum','konto_id','saldo_eur','quelle'],[d('2026-10-11'),'KRAKEN_EUR',48698.51,''],[d('2026-08-11'),'N26',12392,'']],
 'Snapshots': [['Datum','DKB','Flatex','Kraken','Ledger','Bausparer','N26','Gold','Silber','Summe','Sicher','Mäßig','Unsicher','Quelle'],
   [d('2025-08-28'),'',12200,24198,200000,8400,13300,'','',258098,21700,12200,224198,''],
   [d('2026-01-03'),'',23444,68419,138934,8400,81429,'','',320626,147829,23444,149353,''],
   [d('2026-08-11'),'',48248,56020,99214,8400,12386,37908,9040,271216,115734,48248,107234,''],
   [d('2026-10-11'),0,50041,58459,132293,8400,12386,37446,8744,307769,116161,49555,142053,'']],
}
batch = {'valueRanges': [{'values': tabs[t]} for t in ['Assets','Kurse','Transaktionen','Sparplaene','Konten','Salden','Snapshots']]}

SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
TOKEN_INIT = "localStorage.setItem('anlagen.token', JSON.stringify({access_token:'x', expires: Date.now()+3600e3}));"

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()

    import time, math
    from urllib.parse import urlparse as _u, parse_qs as _q
    def serie(days, base, amp):
        now = time.time() * 1000; step = 300e3 if days <= 1 else 3600e3 if days <= 90 else 864e5
        n = int(days * 864e5 / step)
        return [[now - (n - i) * step, base * (1 + amp * math.sin(i / max(n, 1) * 6) + 0.1 * i / max(n, 1))] for i in range(n + 1)]
    def cg(r):
        q = _q(_u(r.request.url).query); days = float(q['days'][0])
        r.fulfill(json={'prices': serie(days, 70000 if 'bitcoin' in r.request.url else 2100, 0.04)})
    def px(r):
        q = _q(_u(r.request.url).query); rng = q['range'][0]
        days = {'5d': 1, '1mo': 30, '1y': 365}.get(rng, 365)
        base = 3600 if 'GC' in r.request.url else 185 if 'WSRUSA' in r.request.url else 125
        r.fulfill(json={'points': serie(days, base, 0.02)})

    def mocks(pg, proxy=False):
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        cfg = (ROOT/'js/config.js').read_text()
        if proxy: cfg = cfg.replace("KURS_PROXY_URL: ''", "KURS_PROXY_URL: 'https://proxy.test/exec'")
        pg.route('**/js/config.js', lambda r: r.fulfill(body=cfg, content_type='text/javascript'))
        pg.route('https://api.coingecko.com/**', cg)
        pg.route('https://proxy.test/**', px)
        pg.route('https://sheets.googleapis.com/**', lambda r: r.fulfill(json=batch))
        if CHART: pg.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(path=CHART, content_type='text/javascript'))

    # 1) Login-Redirect: Klick führt zu Google mit korrekten Parametern
    ctx = b.new_context(service_workers='block'); pg = ctx.new_page(); mocks(pg)
    seen = {}
    pg.route('https://accounts.google.com/**', lambda r: (seen.update(url=r.request.url), r.fulfill(body='google')))
    pg.goto('http://127.0.0.1:8765/#positionen'); pg.click('#btn-login'); pg.wait_for_timeout(300)
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(seen['url']).query)
    assert q['response_type'] == ['token'] and q['redirect_uri'] == ['http://127.0.0.1:8765/'], q
    assert q['state'][0].endswith('|#positionen'), q['state']
    state = q['state'][0]
    nonce = pg.evaluate("localStorage.getItem('anlagen.oauth_state')")
    print('1 Login-URL ok')

    # 2) Rückkehr mit Token → Daten geladen, URL aufgeräumt, richtige View
    pg.goto(f'http://127.0.0.1:8765/#access_token=abc&expires_in=3599&token_type=Bearer&scope={SCOPE}&state={state}')
    pg.wait_for_selector('#view-positionen table')
    assert pg.url.endswith('/#positionen'), pg.url
    assert 'abc' in pg.evaluate("localStorage.getItem('anlagen.token')")
    print('2 Rückkehr ok →', pg.url)

    # 3) Manipulierter state → kein Token, Fehlermeldung
    pg.evaluate("localStorage.clear(); localStorage.setItem('anlagen.oauth_state','echt')"); pg.goto('about:blank')
    pg.goto(f'http://127.0.0.1:8765/#access_token=evil&expires_in=3599&scope={SCOPE}&state=falsch|%23uebersicht')
    pg.wait_for_timeout(300)
    assert pg.evaluate("localStorage.getItem('anlagen.token')") is None
    assert 'state' in pg.text_content('#login-err'), pg.text_content('#login-err')
    print('3 state-Prüfung ok')

    # 4) Service Worker registriert sich, Manifest-Icons erreichbar
    ctx2 = b.new_context(); pg2 = ctx2.new_page(); mocks(pg2)
    pg2.goto('http://127.0.0.1:8765/')
    ok = pg2.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)")
    man = pg2.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
    for ic in man['icons']: assert pg2.request.get('http://127.0.0.1:8765/' + ic['src']).ok, ic
    print('4 Service Worker aktiv:', ok, '| Icons:', len(man['icons']))
    ctx.close(); ctx2.close()

    for name, vp, scheme in [('desktop', {'width': 1100, 'height': 900}, 'light'), ('mobile', {'width': 390, 'height': 844}, 'dark')]:
        c = b.new_context(viewport=vp, color_scheme=scheme, service_workers='block')
        c.add_init_script(TOKEN_INIT)
        pg = c.new_page(); mocks(pg, proxy=(name == 'desktop'))
        pg.goto('http://127.0.0.1:8765/')
        pg.wait_for_selector('.hero .big')
        for rng in ['24h', 'monat', 'ytd']:
            pg.click(f'#seg-entw button[data-v="{rng}"]'); pg.wait_for_timeout(700)
            print(name, rng, '|', pg.text_content('#entw-delta').strip()[:90], '|', pg.text_content('#entw-info').strip()[:80])
            pg.locator('#ch-entw').screenshot(path=str(OUT/f'{name}-entw-{rng}.png'))
        pg.click('#seg-entw button[data-v="24h"]'); pg.wait_for_timeout(500)
        pg.screenshot(path=str(OUT/f'{name}-uebersicht.png'), full_page=True)
        pg.goto('http://127.0.0.1:8765/#positionen'); pg.wait_for_selector('#view-positionen table')
        pg.screenshot(path=str(OUT/f'{name}-positionen.png'), full_page=True)
        pg.goto('http://127.0.0.1:8765/#historie'); pg.wait_for_timeout(300)
        pg.select_option('#sel-instr', 'BTC'); pg.wait_for_timeout(800)
        pg.screenshot(path=str(OUT/f'{name}-historie.png'), full_page=True)
        pg.goto('http://127.0.0.1:8765/#erfassen'); pg.wait_for_selector('#f-tx')
        pg.screenshot(path=str(OUT/f'{name}-erfassen.png'), full_page=True)
        print(name, 'Summe:', pg.text_content('.hero .big') if pg.query_selector('.hero .big') else '?')
    b.close()
srv.shutdown()
print('ERRORS:', errors or 'keine')
