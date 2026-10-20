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

GIS = """window.google={accounts:{oauth2:{initTokenClient:(c)=>({callback:c.callback,requestAccessToken(){setTimeout(()=>this.callback({access_token:'x',expires_in:3600}),10)}}),
 hasGrantedAllScopes:()=>true,revoke:()=>{}}}};"""

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, scheme in [('desktop', {'width': 1100, 'height': 900}, 'light'), ('mobile', {'width': 390, 'height': 844}, 'dark')]:
        pg = b.new_page(viewport=vp, color_scheme=scheme)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        pg.route('**/gsi/client', lambda r: r.fulfill(body=GIS, content_type='text/javascript'))
        pg.route('**/js/config.js', lambda r: r.fulfill(body=(ROOT/'js/config.js').read_text().replace('HIER_CLIENT_ID', 'test'), content_type='text/javascript'))
        pg.route('https://sheets.googleapis.com/**', lambda r: r.fulfill(json=batch))
        pg.route('https://api.coingecko.com/**', lambda r: r.fulfill(json={'prices': [[1729000000000 + i*86400000, 60000 + i*40 + (i%7)*300] for i in range(365)]}))
        if CHART: pg.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(path=CHART, content_type='text/javascript'))
        pg.goto('http://127.0.0.1:8765/')
        pg.click('#btn-login')
        pg.wait_for_selector('.hero .big')
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
