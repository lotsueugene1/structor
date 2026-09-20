import { Suspense } from "react";

import { StartProject } from "@/components/workspace/start-project";
export default function StartPage() {
  return (
    <Suspense>
      <StartProject />
    </Suspense>
  );
}
