# A proof tape's E opens an item prompt (TEMPLATE-E2E TC-NE5, opus-te2e6)

A new repo's starter tape presses E at Mossgate's chest by its prompt id, `template.chest.use`. The chest's scene is an
item action (it refills the lantern and, since TC-E7, raises `template.chest.opened`), and the page sends that scene, so
the kit takes it. The proof handed the kit the tape's id, which it maps to a scene only for a lever's or a rack's prompt;
the press ran the prompt's script scene instead, the flag never rose and the chest quest filed no fact. The proof now
hands the kit the prompt's scene while that prompt is the one E would pick. `test/author-proof-item-prompt.test.ts`
failed first with `native fact missing: template.chest`.
