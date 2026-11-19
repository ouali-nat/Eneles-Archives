"""UNO entry point for TeXeR IMP.

Registry/Addons.xcu points the Insert-menu entry and the toolbar button at
``service:org.texer.imp.Launcher?open``, which LibreOffice turns into a
call to Launcher.trigger("open"). Everything else lives in the texer_imp
package under pythonpath/, which LibreOffice adds to sys.path for us.
"""

import traceback

import unohelper
from com.sun.star.task import XJobExecutor

IMPLEMENTATION_NAME = "org.texer.imp.Launcher"


class Launcher(unohelper.Base, XJobExecutor):
    def __init__(self, ctx):
        self.ctx = ctx

    def trigger(self, args):
        try:
            from texer_imp import dialog

            dialog.open_window(self.ctx)
        except Exception:
            # Nothing else will surface this: LibreOffice swallows it.
            traceback.print_exc()


g_ImplementationHelper = unohelper.ImplementationHelper()
g_ImplementationHelper.addImplementation(Launcher, IMPLEMENTATION_NAME, ("com.sun.star.task.Job",))
