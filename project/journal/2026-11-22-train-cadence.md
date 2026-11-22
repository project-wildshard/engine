# Start the train clock at the latest staging cut

The reminder saw v0.1.69 and the 10:17 Cancún window. The train's
read-only dry run had already admitted v0.1.70 because its clock used
the v0.1.64 production tag. A production hold could make every newer
staging cut look immediately overdue.

The reminder and the train now use the same rule for prepared and
tagged cuts. The last production tag still supplies the ancestry floor
for candidate selection. The existing on-demand and resume paths still
apply.
