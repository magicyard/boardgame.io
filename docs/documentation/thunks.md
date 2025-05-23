---
title: Thunks in Moves
description: Using thunks for asynchronous or complex move logic in boardgame.io.
---

# Thunks in Moves

Boardgame.io moves can return a special function called a "thunk" to enable more complex or asynchronous game logic. This allows you to dispatch other moves or game events, access the current game state, and perform operations like fetching data from an external API before determining the outcome of a move.

## What is a Thunk?

Normally, a move function in boardgame.io directly returns the new game state `G` (or `INVALID_MOVE`). However, if a move needs to perform asynchronous operations or dispatch other actions as part of its logic, it can return a function instead. This returned function is called a "thunk".

The thunk function receives a special context object with `dispatch` and `getState` methods, along with the original move context (`G`, `ctx`, `playerID`, etc.).

**Why use Thunks?**

*   **Asynchronous Operations:** Perform actions like fetching data from an API, waiting for a timer, or interacting with external services before making further state changes.
*   **Complex Logic & Multiple Actions:** Dispatch multiple moves or game events sequentially based on conditions or results of previous actions.
*   **Side Effects Management:** Isolate side effects (like API calls) within the thunk, keeping the core move logic cleaner.

## Defining a Thunk Move

To define a move that returns a thunk, simply have your move function return another function.

```javascript
// game.js
const game = {
  // ...
  moves: {
    myThunkMove: ({ G, ctx, playerID, ...plugins }) => {
      // Initial synchronous logic (optional)
      // console.log('Original G:', G);

      // Return the thunk function
      return (thunkContext) => {
        // thunkContext contains: { G, ctx, playerID, ...plugins, dispatch, getState }
        // Note: G and ctx in thunkContext are snapshots from when the thunk was created.
        // Use thunkContext.getState() for the most current state if needed before dispatching.
        
        // ... your complex or asynchronous logic here ...
        
        // Example: Dispatch another move
        const currentG = thunkContext.getState().G;
        if (currentG.someCondition) {
          thunkContext.dispatch({ type: 'anotherMove', args: [/* ... */], playerID });
        }
      };
    },

    anotherMove: ({ G }, /* ... */) => {
      // ... logic for anotherMove ...
      return G;
    },
  },
  // ...
};
```

When `myThunkMove` is called, the game engine will execute the outer function. If it returns a function (the thunk), the engine will then immediately invoke this thunk function, providing it with the `thunkContext`.

**Important:** When a move returns a thunk, the game engine's `processMove` function will return the original `G` (the game state *before* the thunk-returning move was processed). Any state changes intended by the thunk must be achieved by dispatching further actions.

## The Thunk Context

The inner thunk function receives a single argument, `thunkContext`, which is an object containing:

*   `G`: A snapshot of the game state `G` at the time the thunk-returning move was initiated.
*   `ctx`: A snapshot of the game context `ctx` at that time.
*   `playerID`: The `playerID` that made the thunk-returning move.
*   `dispatch`: A function to dispatch new actions (moves or game events).
*   `getState`: A function that returns the current, up-to-date game state (`{ G, ctx, ... }`).
*   Any other properties from the original move context (e.g., plugin APIs like `events`, `random`).

### Using `dispatch`

The `dispatch` function allows your thunk to trigger further game state changes by dispatching moves or game events.

*   **Signature**: `dispatch(action)`
    *   `action`: An object describing the action to dispatch. It should generally match the structure of `ActionPayload.MakeMove` or `ActionPayload.GameEvent`.
        *   For moves: `{ type: 'moveName', args: [...], playerID: '...' }`
        *   For game events: `{ type: 'eventName', args: [...], playerID: '...' }` (Note: game events are typically server-only)

*   **Behavior**:
    *   **Server-Side:** When a thunk is executed on the server (or in a single-player game / local master context), `dispatch` will feed the action back into the game's reducer system. This means the dispatched action will be processed like any other regular move or event, potentially triggering further game flow logic (like `endIf` conditions, phase changes, etc.).
    *   **Client-Side (Multiplayer):** When a thunk is executed on the client in a multiplayer game, `dispatch` will send the action to the client's local Redux store. Existing client middleware is then responsible for sending this action to the server (Master) for authoritative processing. The server will process the action and broadcast state updates to all clients.
        *   This means client-side thunks can be used for optimistic updates by dispatching moves that immediately change the local client's state, followed by (or concurrently with) actions intended for server processing.

```javascript
// Inside a thunk on the client
thunkContext.dispatch({ type: 'updateLocalDisplay', playerID, args: [newValue] }); // Optimistic
thunkContext.dispatch({ type: 'requestServerUpdate', playerID, args: [serverPayload] }); // For server
```

### Using `getState`

The `getState` function provides access to the **current full game state** (`{ G, ctx, ... }`) at the moment `getState()` is called within the thunk. This is crucial if your thunk's logic depends on state changes that might have occurred due to other actions or even earlier dispatches within the same thunk (especially in asynchronous scenarios).

*   **Signature**: `getState()`
*   **Returns**: The current game state object (`State`).

```javascript
// Inside a thunk
const initialStateSnapshot = thunkContext.G; // State when thunk was created

// ... some logic ...

const mostRecentState = thunkContext.getState();
if (mostRecentState.G.someValue !== initialStateSnapshot.someValue) {
  // Logic based on potentially changed state
}
```

## Asynchronous Thunks

Thunks can be `async` functions, allowing you to use `await` for promises, such as API calls or timers.

```javascript
// game.js
const game = {
  // ...
  moves: {
    fetchDataAndMove: ({ playerID }) => async (thunkContext) => {
      try {
        const response = await fetch('/api/data');
        const data = await response.json();
        
        thunkContext.dispatch({ type: 'processFetchedData', args: [data], playerID });
      } catch (error) {
        console.error("Failed to fetch data:", error);
        // Optionally dispatch an error handling move/event
        thunkContext.dispatch({ type: 'apiError', args: [error.message], playerID });
      }
    },

    processFetchedData: ({ G }, data) => {
      // Update G based on data
      return { ...G, externalData: data };
    },
    
    apiError: ({ G }, errorMessage) => {
      return { ...G, error: errorMessage };
    }
  },
  // ...
};
```
When an `async` thunk is used, the game engine does not wait for the promise to resolve. The thunk executes, and any dispatches it makes later will be processed as they arrive.

## Client-Side Thunks in Multiplayer

On the client in a multiplayer setup, thunks behave similarly but with a key difference for `dispatch`:
*   `dispatch` sends the action to the client's local Redux store.
*   The client's network transport middleware then forwards this action to the server (Master).
*   The Master processes the action authoritatively and broadcasts state updates.

This allows for:
1.  **Optimistic Updates:** A client-side thunk can dispatch a move that immediately updates its local UI (e.g., showing a piece move instantly).
2.  **Server Communication:** The same thunk can then dispatch another action (or the same action if it's intended for the server) that gets sent to the master for validation and to update the authoritative game state.

```javascript
// game.js
const game = {
  setup: () => ({ clientOnlyValue: 0, serverConfirmedValue: 0 }),
  moves: {
    // This move is designed to be client-only for optimistic updates
    setClientValueOptimistic: ({ G }, newValue) => {
      return { ...G, clientOnlyValue: newValue };
    },
    // This move is processed by the server
    setServerValue: ({ G }, newValue) => {
      return { ...G, serverConfirmedValue: newValue };
    },

    clientSideThunk: ({ playerID }) => async (thunkContext) => {
      // 1. Optimistic update on this client
      thunkContext.dispatch({ type: 'setClientValueOptimistic', args: [5], playerID });
      
      // Simulate some client-side async work or user interaction
      await new Promise(resolve => setTimeout(resolve, 100)); 
      
      // 2. Dispatch the action that should go to the server
      thunkContext.dispatch({ type: 'setServerValue', args: [10], playerID });
    }
  }
};
```
In this example, when `clientSideThunk` is called:
1.  `setClientValueOptimistic` is dispatched. The calling client's `G.clientOnlyValue` becomes 5 immediately. This action is *not* typically sent to the server if the move is marked as `client: false` or if your transport layer filters it.
2.  After the delay, `setServerValue` is dispatched. This action is sent to the server. The server processes it, updates its authoritative `G.serverConfirmedValue` to 10, and then broadcasts this change to all clients. Both clients (including the one that initiated the thunk) will eventually receive the update where `G.serverConfirmedValue` is 10.

## Impact on `G` and Return Values

When a move returns a thunk, the `processMove` function (which is part of the game object created by `ProcessGameConfig`) **returns the original `G` immediately**. It does not wait for the thunk (or any actions dispatched by the thunk) to complete.

The thunk itself does not return a new `G`. Any state changes resulting from the thunk's logic must be performed by actions dispatched via `thunkContext.dispatch(...)`. These dispatched actions will then go through the standard Redux/boardgame.io reducer pipeline.

## Best Practices and Considerations

*   **Idempotency (for server thunks):** If a server thunk might dispatch actions that could be re-processed (e.g., due to retries or complex flows), design the dispatched actions and corresponding moves to be idempotent where possible.
*   **Error Handling:** In `async` thunks, use `try...catch` blocks to handle potential errors from promises (like API failures) and dispatch appropriate error-handling moves or events if necessary.
*   **State Snapshots:** Remember that `thunkContext.G` and `thunkContext.ctx` are snapshots. Use `thunkContext.getState()` if you need the very latest state before a dispatch, especially if the thunk dispatches multiple actions or involves `await` points.
*   **Client vs. Server Logic:** Clearly define which moves are intended for optimistic client-side updates and which are for authoritative server processing. Use the `move.client = false` flag for server-only moves if they shouldn't run on the client at all.
*   **Complexity:** Thunks are powerful but can add complexity. Use them when the benefits of asynchronous operations or multi-step action sequences outweigh this added complexity. For simple, synchronous state changes, a regular move is usually sufficient.
*   **Testing:**
    *   For server-side thunks, ensure your test setup correctly provides a `masterDispatch` to `CreateGameReducer` that can re-dispatch actions to the test store. Use `TransientHandlingMiddleware` if you need to inspect errors from invalid dispatches.
    *   For client-side thunks in multiplayer tests, use `LocalTransport` and allow time for actions to propagate to the master and back to clients.

Thunks provide a flexible way to manage advanced move logic within the boardgame.io framework, opening up possibilities for richer interactions and asynchronous behaviors in your games.
---
This page should be linked from:
*   `docs/documentation/api/Game.md` (in the "Moves" section, perhaps with a brief mention and a link to this new page for details).
*   Possibly from a "Concepts" page or an "Advanced Topics" section if one exists or is created.

This draft covers the guidelines provided. It introduces thunks, explains their definition and context, details `dispatch` and `getState`, covers asynchronous and client-side behavior, clarifies the impact on `G`, and provides examples and best practices.
