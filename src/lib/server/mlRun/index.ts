/**
 * how a client outside the web ui drives an ml intern run, clients resolve their own principal
 * into App.Locals and keep their own delivery state
 * every call checks the run belongs to the owner it is given, the client must still check its
 * caller may act for that owner
 */
export * from "./commands";
export * from "./readModel";
export * from "./sideQuestion";
export * from "./managed";
export type * from "./types";
