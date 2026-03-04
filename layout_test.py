"""
XTIX CRM — Panel Layout Validator v1
Run: python3 layout_test.py [path/to/index.html]
Validates all 6 panels render correctly at 1440x900.
"""
import asyncio, sys, os
from playwright.async_api import async_playwright

HTML = sys.argv[1] if len(sys.argv) > 1 else "index.html"
if not HTML.startswith("file://"): HTML = "file://" + os.path.abspath(HTML)

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page   = await browser.new_page(viewport={"width":1440,"height":900})
        await page.goto(HTML)
        await page.wait_for_timeout(800)
        await page.evaluate("""(()=>{
            var ls=document.getElementById('login-screen');if(ls)ls.style.display='none';
            var aw=document.getElementById('app-wrapper');if(aw)aw.style.display='flex';
        })()""")
        await page.wait_for_timeout(600)

        panels = ['leads','leadfinder','market','methodology','hubspot','aichat']
        fails  = []
        print(f"\n{'─'*55}")
        print(f"{'PANEL':14s}  {'STATUS':8s}  SIDEBAR  MAIN    PANEL-Y")
        print(f"{'─'*55}")
        for panel in panels:
            await page.evaluate(f"""(()=>{{
                document.querySelectorAll('.panel').forEach(e=>e.classList.remove('active'));
                var t=document.getElementById('tab-{panel}');if(t)t.classList.add('active');
            }})()""")
            await page.wait_for_timeout(180)
            d = await page.evaluate(f"""(()=>{{
                function r(el){{if(!el)return null;var rc=el.getBoundingClientRect();
                  return{{x:Math.round(rc.x),y:Math.round(rc.y),w:Math.round(rc.width)}};}}
                return{{sb:r(document.getElementById('sidebar')),
                        mn:r(document.getElementById('main-content')),
                        pn:r(document.getElementById('tab-{panel}'))}};
            }})()""")
            sb,mn,pn = d['sb'],d['mn'],d['pn']
            ok = sb and sb['w']==210 and mn and mn['w']>=1200 and pn and pn['y']<900
            if not ok: fails.append(panel)
            st = "✅ PASS" if ok else "❌ FAIL"
            print(f"{panel:14s}  {st}  {sb['w'] if sb else '?':>5}px  {mn['w'] if mn else '?':>5}px  {pn['y'] if pn else '?':>5}px")
        print(f"{'─'*55}")
        print(f"\n{'🎉 ALL PASS (6/6)' if not fails else '⚠  FAILED: '+str(fails)}\n")
        await browser.close()
        return len(fails)==0

result = asyncio.run(run())
exit(0 if result else 1)
