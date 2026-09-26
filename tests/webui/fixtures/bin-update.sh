#!/system/bin/sh
# Stand-in for module/bin-update.sh: answers from the test root's
# data/adb/nyxtest/bin_mode (uptodate, differs, ...) instead of downloading.
mode=$(cat "${NYX_TEST_ROOT}/data/adb/nyxtest/bin_mode" 2> /dev/null || echo uptodate)
sleep 1
case "$1" in
    check)
        echo "status=$mode"
        echo "local=aaaa"
        echo "remote=bbbb"
        echo "detail=stub detail for $mode"
        echo "message=stub commit message"
        ;;
    apply)
        echo "status=installed"
        echo "detail=Installed the published binary"
        ;;
esac
