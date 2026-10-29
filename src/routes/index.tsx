import { createFileRoute } from "@tanstack/react-router";
import { PekabillarApp } from "@/game/PekabillarApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <PekabillarApp />;
}
