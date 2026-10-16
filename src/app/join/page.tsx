import type { Metadata } from "next";
import JoinFlow from "./JoinFlow";

export const metadata: Metadata = {
  title: "Join the RoboValley Community",
  description: "Create your RoboValley account",
};

export default function JoinPage() {
  return <JoinFlow />;
}
