import {QuestLine} from '../../src/shared/engine/quest/core';
import type {SimHost} from '../../src/server/engine/sim';
import type {parseChapterStoryPresentation} from '@wildshard/format/questStory';
import {chapterFlow} from '../../src/shared/game/quest/chapterFlow';

/** Observe the page's actual chapter readouts over the existing native quest
 * owners. No quest, flag, dialogue clock or completion callback is replaced. */
export function installNalatiChapterObservation(host:SimHost,story:ReturnType<typeof parseChapterStoryPresentation>):void {
  const line=new QuestLine([],host.flags);
  for(const id of story.chapters){
    const quest=host.quests.find(row=>row.def.id===id);
    if(quest===undefined)throw new Error('Native chapter observation lacks its admitted quest');
    line.chapters.push(quest);
  }
  const flow=chapterFlow(line,story);
  const snapshot=():string=>{
    if(host.scope.disposed||host.scope.disposing)throw new Error('Native chapter observer retired');
    return JSON.stringify({chip:flow.chip(),map:flow.mapQuest(),feats:flow.feats(host.flags),
      chapters:line.chapters.map(quest=>({id:quest.def.id,started:quest.isStarted,complete:quest.isComplete,
        current:quest.current?.id??null,objective:quest.objective(),hint:quest.hint(),markers:quest.markers()}))});
  };
  host.onStep('nalati.chapter',()=>{}, {snapshot,restore:value=>{
    if(value!==snapshot())throw new Error('Chapter observation differs from its restored quest owners');
  }});
  // The line borrows these states: only DeclaredQuests disposes their owners.
  host.scope.onDispose(()=>{line.chapters.length=0;});
}
