import { Suspense } from "react";

import { Workspace } from "@/components/workspace/workspace";
export default function WorkspacePage() {
  return (
    <Suspense>
      <Workspace licenseKey={process.env.TLDRAW_LICENSE_KEY} />
    </Suspense>
  );
}
