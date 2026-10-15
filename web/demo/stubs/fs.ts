// node:fs for the browser demo: there are no files, so nothing exists and every read fails the way a
// missing file would. Only the routes that need a machine reach these (file preview, uploads, transcripts).
const missing = (): never => {
  throw Object.assign(new Error("no files in the browser demo"), { code: "ENOENT" });
};
export const existsSync = (): boolean => false;
export const readdirSync = missing;
export const readFileSync = missing;
export const statSync = missing;
export const realpathSync = missing;
export const openSync = missing;
export const readSync = missing;
export const closeSync = (): void => {};
export const writeFileSync = missing;
export const mkdirSync = missing;
export const renameSync = missing;
export const copyFileSync = missing;
export const chmodSync = missing;
export const rmSync = missing;
export default { existsSync, readdirSync, readFileSync, statSync, realpathSync, openSync, readSync, closeSync };
