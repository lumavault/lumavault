import "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Shown in the dashboard header. */
    title?: string;
  }
}
