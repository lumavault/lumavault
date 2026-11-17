import { App } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { Clapperboard, Gamepad2, Images, type LucideIcon } from "lucide-react";

export type IamApp = "photos" | "cinema" | "arcade";

export interface AppInfo {
  key: IamApp;
  wire: App;
  name: string;
  description: string;
  icon: LucideIcon;
}

export const APPS: AppInfo[] = [
  { key: "photos", wire: App.PHOTOS, name: "Photos", description: "Your timeline, albums, and shared memories.", icon: Images },
  { key: "cinema", wire: App.CINEMA, name: "Cinema", description: "Movies and shows from your library.", icon: Clapperboard },
  { key: "arcade", wire: App.ARCADE, name: "Arcade", description: "Your games and save files.", icon: Gamepad2 },
];

export function appInfo(app: App): AppInfo | undefined {
  return APPS.find((a) => a.wire === app);
}
