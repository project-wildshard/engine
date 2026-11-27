# Zone table and service worker routes under builds/

Fix-preview PV9 follow-up, opus-pvpage. After rebasing onto opus-pvclient's PV4 slice, the zone table's copy
beside the build's code moved from b/<build>/ to builds/<engineVersion>/<build>/ (checkCodeLayout refuses b/ in a
new build), sw.js's native cache routes take /builds/* as well as a carried build's /b/*, and the failmode deploy
fixture copies the PV9 folder under the next build's name.
