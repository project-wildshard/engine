# Carry the current cook admission identity

The heavy-test owner's cook validation change advances the generated
admission revision from 37f26958 to 7aac2007. Recomputing the public
revision function against the current committed source matches the
generated stamp exactly. Commit that required byte before the release
lane's final normal full push; no validator rule or secret is changed.
