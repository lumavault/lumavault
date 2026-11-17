// @lumavault/ui: headless building blocks shared by the four web apps. Behavior and
// accessibility come from Base UI; every app brings its own styles, so nothing here sets a
// color, font, or layout.

// Primitives, unstyled. Style them with className or the data attributes Base UI sets.
export { Dialog } from "@base-ui/react/dialog";
export { Menu } from "@base-ui/react/menu";
export { Progress } from "@base-ui/react/progress";
export { Select } from "@base-ui/react/select";
export { Switch } from "@base-ui/react/switch";
export { Tabs } from "@base-ui/react/tabs";
export { Toast } from "@base-ui/react/toast";
export { Tooltip } from "@base-ui/react/tooltip";

// API access and the active household.
export { createApiTransport, LumaVaultProvider, type LumaVaultProviderProps } from "./rpc/provider.js";
export { type ActiveHousehold, useActiveHousehold, useSwitchHousehold, useViewer } from "./household/use-household.js";
export { formatBytes, summarizeUsage, type UsageSummary } from "./format-bytes.js";
