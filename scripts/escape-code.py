# Inside <div c-code><script type="text/plain"> … </script></div> blocks, inner "</script>" must be written
# as "<\/script>" or the browser ends the block early. This fixer makes that automatic for site pages.
import re, sys, pathlib
OPEN = '<script type="text/plain">'
END = '</script></div>'
for path in sys.argv[1:]:
    p = pathlib.Path(path); s = p.read_text(); out = []; i = 0; changed = False
    while True:
        a = s.find(OPEN, i)
        if a < 0: out.append(s[i:]); break
        b = s.find(END, a)
        if b < 0: out.append(s[i:]); break
        inner = s[a + len(OPEN):b]
        fixed = inner.replace('</script>', '<\\/script>')
        changed |= fixed != inner
        out.append(s[i:a + len(OPEN)] + fixed); i = b
    if changed: p.write_text(''.join(out)); print('fixed', path)
