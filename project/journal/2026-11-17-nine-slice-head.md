# Re-cut Nine's server slice after revision 2

Main run 44018874243 exposed a stale Ring 1 slice after the Nine Dragon
revision-2 pin (e02a5a29). The existing pin identity test fails first:
the slice still names the previous head. Re-cut with the ordinary pins
tool; only Nine's from/hash/bytes change, and all five fresh cooks agree.

J393 assigns this forward repair to the lander. Use ALLOW_PIN_PUSH=1
for this explicitly authorized mode-1 repair while main is red, retaining
the ordinary pre-push. Buddy-engine was notified before the edit; its
page-release and generated-file changes stay outside this commit.
