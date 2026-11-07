export interface BudgetGame { frameCount:number; frameGate:()=>boolean }
export interface BudgetControl { remaining:number; free:boolean; advance:(frames:number)=>Promise<void> }
export function bindFrameBudget(game:BudgetGame,control:BudgetControl,requestFrame:(run:FrameRequestCallback)=>number,cancelFrame:(id:number)=>void):()=>void;
