from pathlib import Path
import shutil,re
base=Path('/home/asus/hi3861-dashboard-v120-sdk');sdk=Path('/home/asus/pengan-hsp101-sdk')
if not sdk.exists():shutil.copytree(base,sdk,ignore=shutil.ignore_patterns('build_tmp','output','__pycache__','.sconsign*','out_nv_bin'))
source=Path(__file__).resolve().parent/'src'
for p in source.iterdir():shutil.copyfile(p,sdk/'app/demo/src'/p.name)
p=sdk/'app/demo/src/SConscript';s=p.read_text();s=re.sub(r"objs = env.Object\(.*\)","objs = env.Object(['app_main.c','dashboard.c','dash_core.c','dash_nfc.c','dash_web.c','ssd1306_fonts.c','app_demo_upg_verify.c'])",s);p.write_text(s)
