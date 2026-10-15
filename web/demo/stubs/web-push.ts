// web-push for the browser demo: the demo sends no notifications.
const refuse = (): never => {
  throw new Error("no push in the browser demo");
};
export default { setVapidDetails: () => {}, sendNotification: refuse, generateVAPIDKeys: refuse };
