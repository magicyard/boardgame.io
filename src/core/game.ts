/*
 * Copyright 2017 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import * as plugins from '../plugins/main';
import { Flow } from './flow';
import { INVALID_MOVE } from './constants'; // Ensure INVALID_MOVE is imported
import type { ActionPayload, Game, Move, LongFormMove, State, ActionShape } from '../types'; // Added ActionShape
import * as logging from './logger';
import { GameMethod } from './game-methods';

type ProcessedGame = Game & {
  flow: ReturnType<typeof Flow>;
  moveNames: string[];
  pluginNames: string[];
  processMove: (
    state: State,
    action: ActionPayload.MakeMove
  ) => State | typeof INVALID_MOVE;
};

function IsProcessed(game: Game | ProcessedGame): game is ProcessedGame {
  return game.processMove !== undefined;
}

/**
 * Helper to generate the game move reducer. The returned
 * reducer has the following signature:
 *
 * (G, action, ctx) => {}
 *
 * You can roll your own if you like, or use any Redux
 * addon to generate such a reducer.
 *
 * The convention used in this framework is to
 * have action.type contain the name of the move, and
 * action.args contain any additional arguments as an
 * Array.
 */
export function ProcessGameConfig(
  game: Game | ProcessedGame,
  isClient?: boolean,
  clientDispatch?: (action: ActionShape.Any) => void,
  serverThunkDispatcher?: (action: ActionShape.Any) => void
): ProcessedGame {
  // The Game() function has already been called on this
  // config object, so just pass it through.
  if (IsProcessed(game)) {
    return game;
  }

  if (game.name === undefined) game.name = 'default';
  if (game.deltaState === undefined) game.deltaState = false;
  if (game.disableUndo === undefined) game.disableUndo = false;
  if (game.setup === undefined) game.setup = () => ({});
  if (game.moves === undefined) game.moves = {};
  if (game.playerView === undefined) game.playerView = ({ G }) => G;
  if (game.plugins === undefined) game.plugins = [];

  game.plugins.forEach((plugin) => {
    if (plugin.name === undefined) {
      throw new Error('Plugin missing name attribute');
    }
    if (plugin.name.includes(' ')) {
      throw new Error(plugin.name + ': Plugin name must not include spaces');
    }
  });

  if (game.name.includes(' ')) {
    throw new Error(game.name + ': Game name must not include spaces');
  }

  const flow = Flow(game);

  return {
    ...game,

    flow,

    moveNames: flow.moveNames as string[],

    pluginNames: game.plugins.map((p) => p.name) as string[],

    processMove: (state: State, action: ActionPayload.MakeMove) => {
      // Get the move function from the flow object.
      let moveFn = flow.getMove(state.ctx, action.type, action.playerID);

      // If it's a long-form move, extract the actual move function.
      if (IsLongFormMove(moveFn)) {
        moveFn = moveFn.move;
      }

      // Check if moveFn is a function.
      if (moveFn instanceof Function) {
        // Wrap the move function with plugin wrappers.
        const fn = plugins.FnWrap(moveFn, GameMethod.MOVE, game.plugins);
        
        let args = [];
        if (action.args !== undefined) {
          args = Array.isArray(action.args) ? action.args : [action.args];
        }

        // Prepare the context for the move function.
        const context = {
          ...plugins.GetAPIs(state),
          G: state.G,
          ctx: state.ctx,
          playerID: action.playerID,
        };

        // Call the move function.
        const moveResult = fn(context, ...args);

        // Check if the result is a thunk (a function).
        if (typeof moveResult === 'function') {
          // This is a thunk.
          const getState = () => {
            logging.info('GetState called by thunk');
            // This state is the state object from processMove's scope when the thunk-returning move was called.
            return state;
          };

          const dispatch = (actionToDispatch: ActionShape.MakeMove | ActionShape.GameEvent) => {
            logging.info('Thunk dispatch called with action:', actionToDispatch);

            const isClientContext = !!isClient; // Use the isClient parameter from ProcessGameConfig

            if (isClientContext) {
              if (clientDispatch) {
                logging.info('Client thunk dispatching action to local store:', actionToDispatch);
                clientDispatch(actionToDispatch);
                // Existing client middleware should pick this up and send to server.
              } else {
                logging.error('Client thunk dispatch called, but no clientDispatch function was provided to ProcessGameConfig.');
              }
            } else { // Server context
              if (serverThunkDispatcher) {
                logging.info('Dispatching action via serverThunkDispatcher:', actionToDispatch);
                serverThunkDispatcher(actionToDispatch);
              } else {
                logging.error('serverThunkDispatcher not provided in server context for thunk dispatch');
              }
            }
          };

          // Execute the thunk with dispatch, getState, and the original context.
          // The thunk's execution might be asynchronous, but its immediate call is synchronous here.
          moveResult({ ...context, dispatch, getState });

          // If a thunk is returned, the G modification is deferred.
          // Return the original G, indicating that the thunk will handle future state changes.
          return state.G;
        } else {
          // This is a standard move returning G or INVALID_MOVE.
          // Return the result (new G or INVALID_MOVE).
          return moveResult;
        }
      }

      // If moveFn was not a function, log an error and return INVALID_MOVE.
      // (The original code returned state.G here, but INVALID_MOVE or throwing an error is more appropriate
      // if the move definition is incorrect.)
      logging.error(`invalid move object: ${action.type}`);
      // It's important that an invalid move type returns INVALID_MOVE
      // for the reducer to correctly handle it.
      return INVALID_MOVE; // Ensure this constant is imported or defined.
    },
  };
}

export function IsLongFormMove(move: Move): move is LongFormMove {
  return move instanceof Object && (move as LongFormMove).move !== undefined;
}
