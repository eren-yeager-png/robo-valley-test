import type { Metadata } from "next";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { tableExists } from "../../../lib/adminStats";
import { CATEGORIES, parseCategory } from "../../../lib/serviceCategories";
import UploadForm from "../_components/UploadForm";
import { PageHeader } from "../_components/ui";

export const metadata: Metadata = { title: "Upload files | RoboValley admin", robots: { index: false, follow: false } };

export default async function UploadPage({ searchParams }: { searchParams?: Promise<{ category?: string }> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const filesReady = await tableExists(pool, "upload_attachments");
  const initial = parseCategory((await searchParams)?.category) ?? "";
  return (
    <>
      <PageHeader title="Upload files" lead="Add school data to one category, or store a document. Every upload is recorded in the history." />
      <UploadForm categories={CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }))} initialCategory={initial} filesReady={filesReady} />
    </>
  );
}
