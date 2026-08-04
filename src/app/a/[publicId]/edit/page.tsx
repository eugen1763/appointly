import type { Metadata } from "next";

import { EditLinkClient } from "./EditLinkClient";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

interface EditLinkPageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

export default async function EditLinkPage({ params }: EditLinkPageProps) {
  const { publicId } = await params;
  return <EditLinkClient publicId={publicId} />;
}
