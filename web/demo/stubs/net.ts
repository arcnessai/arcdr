// node:net for the browser demo: there is no herdr socket to reach.
export const createConnection = (): never => {
  throw new Error("no herdr socket in the browser demo");
};
export default { createConnection };
