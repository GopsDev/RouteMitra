import traceback
def run():
	try:
		from routemitra.tmp_mfg_clean import run as clean
		clean()
	except Exception:
		traceback.print_exc()
