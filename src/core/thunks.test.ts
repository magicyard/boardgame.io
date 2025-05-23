import { CreateGameReducer, TransientHandlingMiddleware } from './reducer';
import type { Game, PlayerID, State, ActionPayload, ActionShape } from '../types';
import { createStore, Store, applyMiddleware } from 'redux';
import { makeMove } from './action-creators'; // Used for dispatching moves to the store
import * as logging from './logger'; // Optional: for temporary debugging
import { INVALID_MOVE } from './constants';
import { ActionErrorType } from './errors';

// Suppress console logging for tests if it's too noisy, or use a mock.
// jest.spyOn(logging, 'info').mockImplementation(() => {});
// jest.spyOn(logging, 'error').mockImplementation(() => {});


// Test Suite for Server-Side Synchronous Thunks
describe('Server-Side Synchronous Thunks', () => {
  // Test 1: Thunk dispatching a move that changes G
  test('Thunk dispatching a move that changes G', () => {
    const game: Game = {
      setup: () => ({ value: 1 }), // G is directly the state here as per boardgame.io convention
      moves: {
        increment: ({ G }) => ({ ...G, value: G.value + 1 }),
        thunkIncrement: ({ playerID }) => (thunkContext) => {
          // Dispatch an action object that matches ActionPayload.MakeMove
          const actionToDispatch: ActionPayload.MakeMove = {
            type: 'increment',
            args: [],
            playerID,
            // credentials and metadata are not strictly needed for this core test
          };
          thunkContext.dispatch(actionToDispatch);
        },
      },
    };

    let store: Store<State>;
    const reducer = CreateGameReducer({
      game,
      isClient: false,
      masterDispatch: (action) => {
        store.dispatch(action as any);
      },
    });
    store = createStore(reducer); 

    expect(store.getState().G.value).toBe(1);
    store.dispatch(makeMove('thunkIncrement', [], '0'));
    expect(store.getState().G.value).toBe(2);
  });

  test('Thunk dispatching a move that changes ctx (ends turn)', () => {
    const game: Game = {
      setup: () => ({}), 
      moves: {
        noopMove: () => { /* Does nothing to G */ },
        thunkEndTurn: ({ playerID }) => (thunkContext) => {
          const actionToDispatch: ActionPayload.MakeMove = {
            type: 'noopMove',
            args: [],
            playerID,
          };
          thunkContext.dispatch(actionToDispatch);
        },
      },
      turn: {
        endIf: ({ ctx }) => (ctx.numMoves || 0) >= 1,
      },
    };

    let store: Store<State>;
    const reducer = CreateGameReducer({
      game,
      isClient: false,
      masterDispatch: (action) => {
        store.dispatch(action as any);
      },
      numPlayers: 2, 
    });
    
    const initialG = game.setup ? game.setup({ ctx: { numPlayers: 2 } as any }) : {};
    const initialState: State = {
      G: initialG,
      ctx: {
        numPlayers: 2,
        turn: 1,
        currentPlayer: '0',
        playOrder: ['0', '1'],
        playOrderPos: 0,
        activePlayers: null,
        numMoves: 0, 
        gameover: undefined,
        phase: '', 
        _activePlayersMoveLimit: {},
        _activePlayersNumMoves: {},
        _nextActivePlayers: null,
        _random: { seed: "test_seed" } 
      },
      plugins: {}, 
      _stateID: 0,
      deltalog: [],
      _undo: [],
      _redo: [],
    };
    store = createStore(reducer, initialState);

    expect(store.getState().ctx.turn).toBe(1);
    expect(store.getState().ctx.currentPlayer).toBe('0');
    expect(store.getState().ctx.numMoves).toBe(0);

    store.dispatch(makeMove('thunkEndTurn', [], '0'));

    expect(store.getState().ctx.turn).toBe(2);
    expect(store.getState().ctx.currentPlayer).toBe('1');
    expect(store.getState().ctx.numMoves).toBe(0);
  });

  test('getState reflects state at thunk creation in server-side thunk', () => {
    const game: Game = {
      setup: () => ({ value: 1 }), 
      moves: {
        updateValue: ({ G }, newValue) => ({ ...G, value: newValue }),
        thunkCheckGetState: ({ playerID }) => (thunkContext) => {
          const currentState = thunkContext.getState();
          const actionToDispatch: ActionPayload.MakeMove = {
            type: 'updateValue', 
            args: [currentState.G.value + 10], 
            playerID,
          };
          thunkContext.dispatch(actionToDispatch);
        },
      },
    };

    let store: Store<State>;
    const reducer = CreateGameReducer({
      game,
      isClient: false,
      masterDispatch: (action) => {
        store.dispatch(action as any);
      },
    });
    store = createStore(reducer);

    expect(store.getState().G.value).toBe(1);
    store.dispatch(makeMove('updateValue', [5], '0'));
    expect(store.getState().G.value).toBe(5); 
    store.dispatch(makeMove('thunkCheckGetState', [], '0'));
    expect(store.getState().G.value).toBe(15);
  });
});

describe('Server-Side Asynchronous Thunks', () => {
  test('Async thunk dispatching a move that changes G', async () => {
    const game: Game = {
      setup: () => ({ value: 1 }),
      moves: {
        increment: ({ G }) => ({ ...G, value: G.value + 1 }),
        asyncThunkIncrement: ({ playerID }) => async (thunkContext) => {
          await Promise.resolve(); 
          const actionToDispatch: ActionPayload.MakeMove = {
            type: 'increment',
            args: [],
            playerID,
          };
          thunkContext.dispatch(actionToDispatch);
        },
      },
    };

    let store: Store<State>;
    const reducer = CreateGameReducer({
      game,
      isClient: false,
      masterDispatch: (action) => {
        store.dispatch(action as any);
      },
    });
    store = createStore(reducer);

    expect(store.getState().G.value).toBe(1);
    store.dispatch(makeMove('asyncThunkIncrement', [], '0'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getState().G.value).toBe(2);
  });

  test('Async thunk dispatching a move that changes ctx (ends turn)', async () => {
    const game: Game = {
      setup: () => ({}),
      moves: {
        noopMove: () => { /* Does nothing to G */ },
        asyncThunkEndTurn: ({ playerID }) => async (thunkContext) => {
          await Promise.resolve(); 
          const actionToDispatch: ActionPayload.MakeMove = {
            type: 'noopMove',
            args: [],
            playerID,
          };
          thunkContext.dispatch(actionToDispatch);
        },
      },
      turn: {
        endIf: ({ ctx }) => (ctx.numMoves || 0) >= 1,
      },
    };

    let store: Store<State>;
    const reducer = CreateGameReducer({
      game,
      isClient: false,
      masterDispatch: (action) => {
        store.dispatch(action as any);
      },
      numPlayers: 2,
    });

    const initialG = game.setup ? game.setup({ ctx: { numPlayers: 2 } as any }) : {};
    const initialState: State = {
      G: initialG,
      ctx: {
        numPlayers: 2,
        turn: 1,
        currentPlayer: '0',
        playOrder: ['0', '1'],
        playOrderPos: 0,
        activePlayers: null,
        numMoves: 0,
        gameover: undefined,
        phase: '',
        _activePlayersMoveLimit: {},
        _activePlayersNumMoves: {},
        _nextActivePlayers: null,
        _random: { seed: "test_seed_async" } 
      },
      plugins: {},
      _stateID: 0,
      deltalog: [],
      _undo: [],
      _redo: [],
    };
    store = createStore(reducer, initialState);

    expect(store.getState().ctx.turn).toBe(1);
    expect(store.getState().ctx.currentPlayer).toBe('0');
    expect(store.getState().ctx.numMoves).toBe(0);

    store.dispatch(makeMove('asyncThunkEndTurn', [], '0'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(store.getState().ctx.turn).toBe(2);
    expect(store.getState().ctx.currentPlayer).toBe('1');
    expect(store.getState().ctx.numMoves).toBe(0);
  });
});

// Test Suite for Server-Side Thunks - Invalid Dispatches
describe('Server-Side Thunks - Invalid Dispatches', () => {
  test('Thunk dispatching a move for the wrong player', () => {
    const game: Game = {
      setup: () => ({ G: { value: 0 }, ctx: { currentPlayer: '0', numPlayers: 2 } }), // Ensure G is an object
      moves: {
        validMove: ({ G, playerID }) => {
          if (playerID === '0') return { ...G, value: G.value + 1 };
          return INVALID_MOVE; // Explicitly return for other players
        },
        thunkDispatchWrongPlayer: ({ playerID }) => (thunkContext) => {
          // playerID is '0' when this thunk is called
          const actionToDispatch: ActionPayload.MakeMove = {
            type: 'validMove',
            playerID: '1', // Thunk attempts to dispatch as player '1'
            args: [],
          };
          thunkContext.dispatch(actionToDispatch);
        },
      },
    };

    let store: Store<State>;
    const reducer = CreateGameReducer({
      game,
      isClient: false,
      masterDispatch: (action) => {
         // Simulate re-entry; the action already contains the playerID the thunk specified.
        store.dispatch(action as any);
      },
      numPlayers: 2,
    });
    
    const initialG = game.setup ? game.setup({} as any).G : {}; // Get G from setup
    const initialCtx = game.setup ? game.setup({} as any).ctx : {}; // Get ctx from setup
    const initialState: State = {
      G: initialG,
      ctx: { 
        turn: 1, 
        currentPlayer: '0', 
        numPlayers: 2, 
        playOrder: ['0', '1'],
        playOrderPos: 0,
        activePlayers: null,
        numMoves: 0,
        gameover: undefined,
        phase: '',
        _random: {seed: 'test'},
        ...initialCtx // Spread initial Ctx from game.setup
      },
      plugins: {},
      _stateID: 0,
      deltalog: [],
      _undo: [],
      _redo: [],
    };

    store = createStore(reducer, initialState, applyMiddleware(TransientHandlingMiddleware));
    
    expect(store.getState().G.value).toBe(0);

    // Dispatch the thunk move by player '0'
    const dispatchResult = store.dispatch(makeMove('thunkDispatchWrongPlayer', [], '0') as any);

    // Assertions
    expect(dispatchResult.transients).toBeDefined();
    expect(dispatchResult.transients.error.type).toBe(ActionErrorType.InvalidMove);
    expect(store.getState().G.value).toBe(0); // G should not have changed
  });

  test('Thunk dispatching a move not allowed in the current phase', () => {
    const game: Game = {
      setup: () => ({ G: { value: 0 }, ctx: { phase: 'phaseA', numPlayers: 1 } }),
      phases: {
        phaseA: {
          moves: { moveToPhaseB: ({ G, playerID }) => G }, // Dummy move to allow phase transition if needed
          next: 'phaseB',
          start: true,
        },
        phaseB: {
          moves: { allowedInB: ({ G }) => ({ ...G, value: G.value + 1 }) },
        },
      },
      moves: {
        // Thunk is called in phaseA, tries to dispatch a move only allowed in phaseB
        thunkDispatchOutOfPhase: ({ playerID }) => (thunkContext) => {
          const actionToDispatch: ActionPayload.MakeMove = {
            type: 'allowedInB',
            playerID,
            args: [],
          };
          thunkContext.dispatch(actionToDispatch);
        },
        // Adding moveToPhaseB to global moves as well for simplicity, though it's in phaseA
        moveToPhaseB: ({ G, playerID }) => G, 
      },
    };

    let store: Store<State>;
    const reducer = CreateGameReducer({
      game,
      isClient: false,
      masterDispatch: (action) => {
        store.dispatch(action as any);
      },
      numPlayers: 1,
    });

    const initialG = game.setup ? game.setup({} as any).G : {};
    const initialCtx = game.setup ? game.setup({} as any).ctx : {};
     const initialState: State = {
      G: initialG,
      ctx: { 
        turn: 1, 
        currentPlayer: '0', 
        numPlayers: 1, 
        playOrder: ['0'],
        playOrderPos: 0,
        activePlayers: null,
        numMoves: 0,
        gameover: undefined,
        phase: 'phaseA', // Start in phaseA
        _random: {seed: 'test'},
        ...initialCtx, // Spread Ctx from setup
        phase: 'phaseA', // Ensure phase is phaseA
      },
      plugins: {},
      _stateID: 0,
      deltalog: [],
      _undo: [],
      _redo: [],
    };

    store = createStore(reducer, initialState, applyMiddleware(TransientHandlingMiddleware));

    expect(store.getState().G.value).toBe(0);
    expect(store.getState().ctx.phase).toBe('phaseA');

    // Dispatch the thunk move
    const dispatchResult = store.dispatch(makeMove('thunkDispatchOutOfPhase', [], '0') as any);
    
    // Assertions
    expect(dispatchResult.transients).toBeDefined();
    expect(dispatchResult.transients.error.type).toBe(ActionErrorType.UnavailableMove);
    expect(store.getState().G.value).toBe(0); // G should not have changed
  });
});
