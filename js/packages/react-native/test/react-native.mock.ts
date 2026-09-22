export const Platform = { OS: "ios", Version: "17.5" };
type Handler = (state: string) => void;
const handlers: Handler[] = [];
export const AppState = {
  currentState: "active",
  addEventListener: (_: "change", h: Handler) => {
    handlers.push(h);
    return { remove: () => handlers.splice(handlers.indexOf(h), 1) };
  },
  __emit: (state: string) => handlers.forEach((h) => h(state)),
};
