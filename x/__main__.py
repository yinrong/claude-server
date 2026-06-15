"""python -m x → python -m router"""
import runpy
runpy.run_module("router", run_name="__main__", alter_sys=True)
