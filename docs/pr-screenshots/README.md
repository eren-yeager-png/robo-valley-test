# Screenshots for the review: Contribution Portal, Phase A

Taken on this computer with `tools/contribution-e2e/portal.mjs` (the throw-away local stack: made-up people and data, no real database or site), at 1440, 1024 and 390 pixels wide, before (the code at 86e83a7) and after Phase A. Names: `A-<role>-<page>-<width>-before|after.png`; `demo-` marks the standalone demo (docs/reference/contribution_demo.html). A page that is new in Phase A has an after picture only. The after pictures were taken after the end-to-end check ran on the same database, so they also show its made-up ideas (titles ending in a four-letter run code) and its made-up member accounts.

Checked on every page view (after: 204 views, 0 problems): no sideways scrolling, no overlapping blocks, no stretched buttons, no word broken in the middle, Sent dates on one line, keyboard focus with a visible ring.

## admin-overview

Overview: the Contribution Portal block first (pending publish requests, published this week, rejected, active contributors, the sector grid with publish requests); the site's own data below, unchanged.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-admin-overview-1440-before.png" width="420" alt="A-admin-overview-1440-before.png"> | <img src="A-admin-overview-1440-after.png" width="420" alt="A-admin-overview-1440-after.png"> |
| 1024 | <img src="A-admin-overview-1024-before.png" width="420" alt="A-admin-overview-1024-before.png"> | <img src="A-admin-overview-1024-after.png" width="420" alt="A-admin-overview-1024-after.png"> |
| 390 | <img src="A-admin-overview-390-before.png" width="420" alt="A-admin-overview-390-before.png"> | <img src="A-admin-overview-390-after.png" width="420" alt="A-admin-overview-390-after.png"> |

## admin-publish-requests

Publish Requests (was the Admin Approval Dashboard): a compact sector grid as the filter, tabs Awaiting me / Published / Rejected / Unpublished / All, one table (Title, Sector, Contributor, Approved by, Sent).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-admin-publish-requests-1440-before.png" width="420" alt="A-admin-publish-requests-1440-before.png"> | <img src="A-admin-publish-requests-1440-after.png" width="420" alt="A-admin-publish-requests-1440-after.png"> |
| 1024 | <img src="A-admin-publish-requests-1024-before.png" width="420" alt="A-admin-publish-requests-1024-before.png"> | <img src="A-admin-publish-requests-1024-after.png" width="420" alt="A-admin-publish-requests-1024-after.png"> |
| 390 | <img src="A-admin-publish-requests-390-before.png" width="420" alt="A-admin-publish-requests-390-before.png"> | <img src="A-admin-publish-requests-390-after.png" width="420" alt="A-admin-publish-requests-390-after.png"> |

## admin-publish-preview

New: the publish preview with Publish (green), Send back to moderator and Reject.

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-admin-publish-preview-1440-after.png" width="420" alt="A-admin-publish-preview-1440-after.png"> |
| 1024 | (new page) | <img src="A-admin-publish-preview-1024-after.png" width="420" alt="A-admin-publish-preview-1024-after.png"> |
| 390 | (new page) | <img src="A-admin-publish-preview-390-after.png" width="420" alt="A-admin-publish-preview-390-after.png"> |

## admin-moderation

Moderation for an Admin: the same page a Moderator has (next).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-admin-moderation-1440-before.png" width="420" alt="A-admin-moderation-1440-before.png"> | <img src="A-admin-moderation-1440-after.png" width="420" alt="A-admin-moderation-1440-after.png"> |
| 1024 | <img src="A-admin-moderation-1024-before.png" width="420" alt="A-admin-moderation-1024-before.png"> | <img src="A-admin-moderation-1024-after.png" width="420" alt="A-admin-moderation-1024-after.png"> |
| 390 | <img src="A-admin-moderation-390-before.png" width="420" alt="A-admin-moderation-390-before.png"> | <img src="A-admin-moderation-390-after.png" width="420" alt="A-admin-moderation-390-after.png"> |

## moderator-moderation

Moderation (the Moderator Workspace merged in): sector grid with waiting counts, "Contributors for <Sector>", tabs with counts, ONE table for Share Your Idea and the current form with Approve as-is / Edit & approve / Reject.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-moderator-moderation-1440-before.png" width="420" alt="A-moderator-moderation-1440-before.png"> | <img src="A-moderator-moderation-1440-after.png" width="420" alt="A-moderator-moderation-1440-after.png"> |
| 1024 | <img src="A-moderator-moderation-1024-before.png" width="420" alt="A-moderator-moderation-1024-before.png"> | <img src="A-moderator-moderation-1024-after.png" width="420" alt="A-moderator-moderation-1024-after.png"> |
| 390 | <img src="A-moderator-moderation-390-before.png" width="420" alt="A-moderator-moderation-390-before.png"> | <img src="A-moderator-moderation-390-after.png" width="420" alt="A-moderator-moderation-390-after.png"> |

## moderator-moderation-edit-approve

New: Edit & approve in a side drawer, with the changes against the original.

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-moderator-moderation-edit-approve-1440-after.png" width="420" alt="A-moderator-moderation-edit-approve-1440-after.png"> |
| 1024 | (new page) | <img src="A-moderator-moderation-edit-approve-1024-after.png" width="420" alt="A-moderator-moderation-edit-approve-1024-after.png"> |
| 390 | (new page) | <img src="A-moderator-moderation-edit-approve-390-after.png" width="420" alt="A-moderator-moderation-edit-approve-390-after.png"> |

## moderator-moderation-sector-list

The old one-sector list address (/admin/moderation/sector/<slug>) now opens that sector's panel in Moderation.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-moderator-moderation-sector-list-1440-before.png" width="420" alt="A-moderator-moderation-sector-list-1440-before.png"> | <img src="A-moderator-moderation-sector-list-1440-after.png" width="420" alt="A-moderator-moderation-sector-list-1440-after.png"> |
| 1024 | <img src="A-moderator-moderation-sector-list-1024-before.png" width="420" alt="A-moderator-moderation-sector-list-1024-before.png"> | <img src="A-moderator-moderation-sector-list-1024-after.png" width="420" alt="A-moderator-moderation-sector-list-1024-after.png"> |
| 390 | <img src="A-moderator-moderation-sector-list-390-before.png" width="420" alt="A-moderator-moderation-sector-list-390-before.png"> | <img src="A-moderator-moderation-sector-list-390-after.png" width="420" alt="A-moderator-moderation-sector-list-390-after.png"> |

## moderator-workspace

The old Workspace address (/admin/workspace) now opens Moderation.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-moderator-workspace-1440-before.png" width="420" alt="A-moderator-workspace-1440-before.png"> | <img src="A-moderator-workspace-1440-after.png" width="420" alt="A-moderator-workspace-1440-after.png"> |
| 1024 | <img src="A-moderator-workspace-1024-before.png" width="420" alt="A-moderator-workspace-1024-before.png"> | <img src="A-moderator-workspace-1024-after.png" width="420" alt="A-moderator-workspace-1024-after.png"> |
| 390 | <img src="A-moderator-workspace-390-before.png" width="420" alt="A-moderator-workspace-390-before.png"> | <img src="A-moderator-workspace-390-after.png" width="420" alt="A-moderator-workspace-390-after.png"> |

## admin-sector-forms

Sector Forms in one column: grid ("n fields · m suggestions", amber dot), "Sector form: <Sector>" with + Add field, tabs Fields / Suggested fields, a table of fields (order, slug, source badge, contributions, Active/Hidden, actions).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-admin-sector-forms-1440-before.png" width="420" alt="A-admin-sector-forms-1440-before.png"> | <img src="A-admin-sector-forms-1440-after.png" width="420" alt="A-admin-sector-forms-1440-after.png"> |
| 1024 | <img src="A-admin-sector-forms-1024-before.png" width="420" alt="A-admin-sector-forms-1024-before.png"> | <img src="A-admin-sector-forms-1024-after.png" width="420" alt="A-admin-sector-forms-1024-after.png"> |
| 390 | <img src="A-admin-sector-forms-390-before.png" width="420" alt="A-admin-sector-forms-390-before.png"> | <img src="A-admin-sector-forms-390-after.png" width="420" alt="A-admin-sector-forms-390-after.png"> |

## admin-sector-forms-suggested

New: the Suggested fields tab (Approve, Edit & approve, Reject).

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-admin-sector-forms-suggested-1440-after.png" width="420" alt="A-admin-sector-forms-suggested-1440-after.png"> |
| 1024 | (new page) | <img src="A-admin-sector-forms-suggested-1024-after.png" width="420" alt="A-admin-sector-forms-suggested-1024-after.png"> |
| 390 | (new page) | <img src="A-admin-sector-forms-suggested-390-after.png" width="420" alt="A-admin-sector-forms-suggested-390-after.png"> |

## admin-add-field

New: + Add field (name, the slug made from it, status).

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-admin-add-field-1440-after.png" width="420" alt="A-admin-add-field-1440-after.png"> |
| 1024 | (new page) | <img src="A-admin-add-field-1024-after.png" width="420" alt="A-admin-add-field-1024-after.png"> |
| 390 | (new page) | <img src="A-admin-add-field-390-after.png" width="420" alt="A-admin-add-field-390-after.png"> |

## admin-sector-form-education

A sector's own page now holds its Questions only (its fields moved into the Sector Forms panel).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-admin-sector-form-education-1440-before.png" width="420" alt="A-admin-sector-form-education-1440-before.png"> | <img src="A-admin-sector-form-education-1440-after.png" width="420" alt="A-admin-sector-form-education-1440-after.png"> |
| 1024 | <img src="A-admin-sector-form-education-1024-before.png" width="420" alt="A-admin-sector-form-education-1024-before.png"> | <img src="A-admin-sector-form-education-1024-after.png" width="420" alt="A-admin-sector-form-education-1024-after.png"> |
| 390 | <img src="A-admin-sector-form-education-390-before.png" width="420" alt="A-admin-sector-form-education-390-before.png"> | <img src="A-admin-sector-form-education-390-after.png" width="420" alt="A-admin-sector-form-education-390-after.png"> |

## admin-sectors

Sectors (was Sector Counts): grid, the selected sector's details and numbers (each opens Moderation), every sector's table.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-admin-sectors-1440-before.png" width="420" alt="A-admin-sectors-1440-before.png"> | <img src="A-admin-sectors-1440-after.png" width="420" alt="A-admin-sectors-1440-after.png"> |
| 1024 | <img src="A-admin-sectors-1024-before.png" width="420" alt="A-admin-sectors-1024-before.png"> | <img src="A-admin-sectors-1024-after.png" width="420" alt="A-admin-sectors-1024-after.png"> |
| 390 | <img src="A-admin-sectors-390-before.png" width="420" alt="A-admin-sectors-390-before.png"> | <img src="A-admin-sectors-390-after.png" width="420" alt="A-admin-sectors-390-after.png"> |

## admin-users-roles

Users & Roles (was User Management): "View as" on every person.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-admin-users-roles-1440-before.png" width="420" alt="A-admin-users-roles-1440-before.png"> | <img src="A-admin-users-roles-1440-after.png" width="420" alt="A-admin-users-roles-1440-after.png"> |
| 1024 | <img src="A-admin-users-roles-1024-before.png" width="420" alt="A-admin-users-roles-1024-before.png"> | <img src="A-admin-users-roles-1024-after.png" width="420" alt="A-admin-users-roles-1024-after.png"> |
| 390 | <img src="A-admin-users-roles-390-before.png" width="420" alt="A-admin-users-roles-390-before.png"> | <img src="A-admin-users-roles-390-after.png" width="420" alt="A-admin-users-roles-390-after.png"> |

## admin-view-as

New: View as (read-only): the person's portal, navigation and contributions.

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-admin-view-as-1440-after.png" width="420" alt="A-admin-view-as-1440-after.png"> |
| 1024 | (new page) | <img src="A-admin-view-as-1024-after.png" width="420" alt="A-admin-view-as-1024-after.png"> |
| 390 | (new page) | <img src="A-admin-view-as-390-after.png" width="420" alt="A-admin-view-as-390-after.png"> |

## admin-community-ideas

New: Community Ideas as the public sees it.

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-admin-community-ideas-1440-after.png" width="420" alt="A-admin-community-ideas-1440-after.png"> |
| 1024 | (new page) | <img src="A-admin-community-ideas-1024-after.png" width="420" alt="A-admin-community-ideas-1024-after.png"> |
| 390 | (new page) | <img src="A-admin-community-ideas-390-after.png" width="420" alt="A-admin-community-ideas-390-after.png"> |

## admin-audit-log

New: the Audit Log (who, role, action, item, details; filter by kind).

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-admin-audit-log-1440-after.png" width="420" alt="A-admin-audit-log-1440-after.png"> |
| 1024 | (new page) | <img src="A-admin-audit-log-1024-after.png" width="420" alt="A-admin-audit-log-1024-after.png"> |
| 390 | (new page) | <img src="A-admin-audit-log-390-after.png" width="420" alt="A-admin-audit-log-390-after.png"> |

## student-sectors

Student: the sector grid with idea counts and the panel (published ideas, a Contribute button on the sector and on every field).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-student-sectors-1440-before.png" width="420" alt="A-student-sectors-1440-before.png"> | <img src="A-student-sectors-1440-after.png" width="420" alt="A-student-sectors-1440-after.png"> |
| 1024 | <img src="A-student-sectors-1024-before.png" width="420" alt="A-student-sectors-1024-before.png"> | <img src="A-student-sectors-1024-after.png" width="420" alt="A-student-sectors-1024-after.png"> |
| 390 | <img src="A-student-sectors-390-before.png" width="420" alt="A-student-sectors-390-before.png"> | <img src="A-student-sectors-390-after.png" width="420" alt="A-student-sectors-390-after.png"> |

## teacher-sectors

Teacher: the same, with view-only "Classroom pick" tags.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-teacher-sectors-1440-before.png" width="420" alt="A-teacher-sectors-1440-before.png"> | <img src="A-teacher-sectors-1440-after.png" width="420" alt="A-teacher-sectors-1440-after.png"> |
| 1024 | <img src="A-teacher-sectors-1024-before.png" width="420" alt="A-teacher-sectors-1024-before.png"> | <img src="A-teacher-sectors-1024-after.png" width="420" alt="A-teacher-sectors-1024-after.png"> |
| 390 | <img src="A-teacher-sectors-390-before.png" width="420" alt="A-teacher-sectors-390-before.png"> | <img src="A-teacher-sectors-390-after.png" width="420" alt="A-teacher-sectors-390-after.png"> |

## teacher-sector-page

One sector's full page: unchanged (the same component as the website).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-teacher-sector-page-1440-before.png" width="420" alt="A-teacher-sector-page-1440-before.png"> | <img src="A-teacher-sector-page-1440-after.png" width="420" alt="A-teacher-sector-page-1440-after.png"> |
| 1024 | <img src="A-teacher-sector-page-1024-before.png" width="420" alt="A-teacher-sector-page-1024-before.png"> | <img src="A-teacher-sector-page-1024-after.png" width="420" alt="A-teacher-sector-page-1024-after.png"> |
| 390 | <img src="A-teacher-sector-page-390-before.png" width="420" alt="A-teacher-sector-page-390-before.png"> | <img src="A-teacher-sector-page-390-after.png" width="420" alt="A-teacher-sector-page-390-after.png"> |

## parent-sectors

Parent: "Explore sectors for your family", "Relevant to your child" first, tabs Published ideas / Safe for kids / My contributions.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-parent-sectors-1440-before.png" width="420" alt="A-parent-sectors-1440-before.png"> | <img src="A-parent-sectors-1440-after.png" width="420" alt="A-parent-sectors-1440-after.png"> |
| 1024 | <img src="A-parent-sectors-1024-before.png" width="420" alt="A-parent-sectors-1024-before.png"> | <img src="A-parent-sectors-1024-after.png" width="420" alt="A-parent-sectors-1024-after.png"> |
| 390 | <img src="A-parent-sectors-390-before.png" width="420" alt="A-parent-sectors-390-before.png"> | <img src="A-parent-sectors-390-after.png" width="420" alt="A-parent-sectors-390-after.png"> |

## parent-sectors-my-contributions-tab

New: the parent's My contributions tab (read-only: Title, Status, Sent).

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-parent-sectors-my-contributions-tab-1440-after.png" width="420" alt="A-parent-sectors-my-contributions-tab-1440-after.png"> |
| 1024 | (new page) | <img src="A-parent-sectors-my-contributions-tab-1024-after.png" width="420" alt="A-parent-sectors-my-contributions-tab-1024-after.png"> |
| 390 | (new page) | <img src="A-parent-sectors-my-contributions-tab-390-after.png" width="420" alt="A-parent-sectors-my-contributions-tab-390-after.png"> |

## contributor-sectors

Contributor: "my ideas" on every card, "Contribute to <Sector>", a Contribute button on every field, their ideas in the sector.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-contributor-sectors-1440-before.png" width="420" alt="A-contributor-sectors-1440-before.png"> | <img src="A-contributor-sectors-1440-after.png" width="420" alt="A-contributor-sectors-1440-after.png"> |
| 1024 | <img src="A-contributor-sectors-1024-before.png" width="420" alt="A-contributor-sectors-1024-before.png"> | <img src="A-contributor-sectors-1024-after.png" width="420" alt="A-contributor-sectors-1024-after.png"> |
| 390 | <img src="A-contributor-sectors-390-before.png" width="420" alt="A-contributor-sectors-390-before.png"> | <img src="A-contributor-sectors-390-after.png" width="420" alt="A-contributor-sectors-390-after.png"> |

## contributor-contribute-dialog

New: the short form (Title, Field filled in from the field's button, Description, Attachment).

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-contributor-contribute-dialog-1440-after.png" width="420" alt="A-contributor-contribute-dialog-1440-after.png"> |
| 1024 | (new page) | <img src="A-contributor-contribute-dialog-1024-after.png" width="420" alt="A-contributor-contribute-dialog-1024-after.png"> |
| 390 | (new page) | <img src="A-contributor-contribute-dialog-390-after.png" width="420" alt="A-contributor-contribute-dialog-390-after.png"> |

## student-my-contributions

My Contributions in the portal's table; at 1024 the page no longer scrolls sideways (the table scrolls inside its card).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-student-my-contributions-1440-before.png" width="420" alt="A-student-my-contributions-1440-before.png"> | <img src="A-student-my-contributions-1440-after.png" width="420" alt="A-student-my-contributions-1440-after.png"> |
| 1024 | <img src="A-student-my-contributions-1024-before.png" width="420" alt="A-student-my-contributions-1024-before.png"> | <img src="A-student-my-contributions-1024-after.png" width="420" alt="A-student-my-contributions-1024-after.png"> |
| 390 | <img src="A-student-my-contributions-390-before.png" width="420" alt="A-student-my-contributions-390-before.png"> | <img src="A-student-my-contributions-390-after.png" width="420" alt="A-student-my-contributions-390-after.png"> |

## parent-my-contributions

My Contributions (parent), the same.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-parent-my-contributions-1440-before.png" width="420" alt="A-parent-my-contributions-1440-before.png"> | <img src="A-parent-my-contributions-1440-after.png" width="420" alt="A-parent-my-contributions-1440-after.png"> |
| 1024 | <img src="A-parent-my-contributions-1024-before.png" width="420" alt="A-parent-my-contributions-1024-before.png"> | <img src="A-parent-my-contributions-1024-after.png" width="420" alt="A-parent-my-contributions-1024-after.png"> |
| 390 | <img src="A-parent-my-contributions-390-before.png" width="420" alt="A-parent-my-contributions-390-before.png"> | <img src="A-parent-my-contributions-390-after.png" width="420" alt="A-parent-my-contributions-390-after.png"> |

## contributor-my-contributions

My Contributions (contributor), the same.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-contributor-my-contributions-1440-before.png" width="420" alt="A-contributor-my-contributions-1440-before.png"> | <img src="A-contributor-my-contributions-1440-after.png" width="420" alt="A-contributor-my-contributions-1440-after.png"> |
| 1024 | <img src="A-contributor-my-contributions-1024-before.png" width="420" alt="A-contributor-my-contributions-1024-before.png"> | <img src="A-contributor-my-contributions-1024-after.png" width="420" alt="A-contributor-my-contributions-1024-after.png"> |
| 390 | <img src="A-contributor-my-contributions-390-before.png" width="420" alt="A-contributor-my-contributions-390-before.png"> | <img src="A-contributor-my-contributions-390-after.png" width="420" alt="A-contributor-my-contributions-390-after.png"> |

## moderator-my-contributions

My Contributions (moderator) in the portal's table: Title, Sector, Status, Sent, Actions.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-moderator-my-contributions-1440-before.png" width="420" alt="A-moderator-my-contributions-1440-before.png"> | <img src="A-moderator-my-contributions-1440-after.png" width="420" alt="A-moderator-my-contributions-1440-after.png"> |
| 1024 | <img src="A-moderator-my-contributions-1024-before.png" width="420" alt="A-moderator-my-contributions-1024-before.png"> | <img src="A-moderator-my-contributions-1024-after.png" width="420" alt="A-moderator-my-contributions-1024-after.png"> |
| 390 | <img src="A-moderator-my-contributions-390-before.png" width="420" alt="A-moderator-my-contributions-390-before.png"> | <img src="A-moderator-my-contributions-390-after.png" width="420" alt="A-moderator-my-contributions-390-after.png"> |

## demo-admin-audit

Demo: Audit Log.

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-demo-admin-audit-1440-after.png" width="420" alt="A-demo-admin-audit-1440-after.png"> |
| 1024 | (new page) | <img src="A-demo-admin-audit-1024-after.png" width="420" alt="A-demo-admin-audit-1024-after.png"> |
| 390 | (new page) | <img src="A-demo-admin-audit-390-after.png" width="420" alt="A-demo-admin-audit-390-after.png"> |

## demo-admin-ideas

Demo: Community Ideas (Admin).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-admin-ideas-1440-before.png" width="420" alt="A-demo-admin-ideas-1440-before.png"> | <img src="A-demo-admin-ideas-1440-after.png" width="420" alt="A-demo-admin-ideas-1440-after.png"> |
| 1024 | <img src="A-demo-admin-ideas-1024-before.png" width="420" alt="A-demo-admin-ideas-1024-before.png"> | <img src="A-demo-admin-ideas-1024-after.png" width="420" alt="A-demo-admin-ideas-1024-after.png"> |
| 390 | <img src="A-demo-admin-ideas-390-before.png" width="420" alt="A-demo-admin-ideas-390-before.png"> | <img src="A-demo-admin-ideas-390-after.png" width="420" alt="A-demo-admin-ideas-390-after.png"> |

## demo-admin-overview

Demo: the Admin's Overview.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-admin-overview-1440-before.png" width="420" alt="A-demo-admin-overview-1440-before.png"> | <img src="A-demo-admin-overview-1440-after.png" width="420" alt="A-demo-admin-overview-1440-after.png"> |
| 1024 | <img src="A-demo-admin-overview-1024-before.png" width="420" alt="A-demo-admin-overview-1024-before.png"> | <img src="A-demo-admin-overview-1024-after.png" width="420" alt="A-demo-admin-overview-1024-after.png"> |
| 390 | <img src="A-demo-admin-overview-390-before.png" width="420" alt="A-demo-admin-overview-390-before.png"> | <img src="A-demo-admin-overview-390-after.png" width="420" alt="A-demo-admin-overview-390-after.png"> |

## demo-admin-requests

Demo: Publish Requests.

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-demo-admin-requests-1440-after.png" width="420" alt="A-demo-admin-requests-1440-after.png"> |
| 1024 | (new page) | <img src="A-demo-admin-requests-1024-after.png" width="420" alt="A-demo-admin-requests-1024-after.png"> |
| 390 | (new page) | <img src="A-demo-admin-requests-390-after.png" width="420" alt="A-demo-admin-requests-390-after.png"> |

## demo-admin-sector-forms

Demo: Sector Forms, the same fix and the new screen.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-admin-sector-forms-1440-before.png" width="420" alt="A-demo-admin-sector-forms-1440-before.png"> | <img src="A-demo-admin-sector-forms-1440-after.png" width="420" alt="A-demo-admin-sector-forms-1440-after.png"> |
| 1024 | <img src="A-demo-admin-sector-forms-1024-before.png" width="420" alt="A-demo-admin-sector-forms-1024-before.png"> | <img src="A-demo-admin-sector-forms-1024-after.png" width="420" alt="A-demo-admin-sector-forms-1024-after.png"> |
| 390 | <img src="A-demo-admin-sector-forms-390-before.png" width="420" alt="A-demo-admin-sector-forms-390-before.png"> | <img src="A-demo-admin-sector-forms-390-after.png" width="420" alt="A-demo-admin-sector-forms-390-after.png"> |

## demo-admin-sectors-admin

Demo: Sectors.

| Width | Before | After |
|---|---|---|
| 1440 | (new page) | <img src="A-demo-admin-sectors-admin-1440-after.png" width="420" alt="A-demo-admin-sectors-admin-1440-after.png"> |
| 1024 | (new page) | <img src="A-demo-admin-sectors-admin-1024-after.png" width="420" alt="A-demo-admin-sectors-admin-1024-after.png"> |
| 390 | (new page) | <img src="A-demo-admin-sectors-admin-390-after.png" width="420" alt="A-demo-admin-sectors-admin-390-after.png"> |

## demo-admin-users

Demo: Users & Roles with View as (switches the demo's role).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-admin-users-1440-before.png" width="420" alt="A-demo-admin-users-1440-before.png"> | <img src="A-demo-admin-users-1440-after.png" width="420" alt="A-demo-admin-users-1440-after.png"> |
| 1024 | <img src="A-demo-admin-users-1024-before.png" width="420" alt="A-demo-admin-users-1024-before.png"> | <img src="A-demo-admin-users-1024-after.png" width="420" alt="A-demo-admin-users-1024-after.png"> |
| 390 | <img src="A-demo-admin-users-390-before.png" width="420" alt="A-demo-admin-users-390-before.png"> | <img src="A-demo-admin-users-390-after.png" width="420" alt="A-demo-admin-users-390-after.png"> |

## demo-contributor-home

Demo: Contributor's Dashboard (Dashboard, Sectors, My Contributions).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-contributor-home-1440-before.png" width="420" alt="A-demo-contributor-home-1440-before.png"> | <img src="A-demo-contributor-home-1440-after.png" width="420" alt="A-demo-contributor-home-1440-after.png"> |
| 1024 | <img src="A-demo-contributor-home-1024-before.png" width="420" alt="A-demo-contributor-home-1024-before.png"> | <img src="A-demo-contributor-home-1024-after.png" width="420" alt="A-demo-contributor-home-1024-after.png"> |
| 390 | <img src="A-demo-contributor-home-390-before.png" width="420" alt="A-demo-contributor-home-390-before.png"> | <img src="A-demo-contributor-home-390-after.png" width="420" alt="A-demo-contributor-home-390-after.png"> |

## demo-contributor-mine

Demo: Contributor's My Contributions.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-contributor-mine-1440-before.png" width="420" alt="A-demo-contributor-mine-1440-before.png"> | <img src="A-demo-contributor-mine-1440-after.png" width="420" alt="A-demo-contributor-mine-1440-after.png"> |
| 1024 | <img src="A-demo-contributor-mine-1024-before.png" width="420" alt="A-demo-contributor-mine-1024-before.png"> | <img src="A-demo-contributor-mine-1024-after.png" width="420" alt="A-demo-contributor-mine-1024-after.png"> |
| 390 | <img src="A-demo-contributor-mine-390-before.png" width="420" alt="A-demo-contributor-mine-390-before.png"> | <img src="A-demo-contributor-mine-390-after.png" width="420" alt="A-demo-contributor-mine-390-after.png"> |

## demo-contributor-sectors

Demo: Contributor's Sectors.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-contributor-sectors-1440-before.png" width="420" alt="A-demo-contributor-sectors-1440-before.png"> | <img src="A-demo-contributor-sectors-1440-after.png" width="420" alt="A-demo-contributor-sectors-1440-after.png"> |
| 1024 | <img src="A-demo-contributor-sectors-1024-before.png" width="420" alt="A-demo-contributor-sectors-1024-before.png"> | <img src="A-demo-contributor-sectors-1024-after.png" width="420" alt="A-demo-contributor-sectors-1024-after.png"> |
| 390 | <img src="A-demo-contributor-sectors-390-before.png" width="420" alt="A-demo-contributor-sectors-390-before.png"> | <img src="A-demo-contributor-sectors-390-after.png" width="420" alt="A-demo-contributor-sectors-390-after.png"> |

## demo-moderator-moderation

Demo: THE layout bug fixed by the one .adm.rvd-adm rule: the sector picker, heading and table no longer sit side by side; the pills became the sector grid.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-moderator-moderation-1440-before.png" width="420" alt="A-demo-moderator-moderation-1440-before.png"> | <img src="A-demo-moderator-moderation-1440-after.png" width="420" alt="A-demo-moderator-moderation-1440-after.png"> |
| 1024 | <img src="A-demo-moderator-moderation-1024-before.png" width="420" alt="A-demo-moderator-moderation-1024-before.png"> | <img src="A-demo-moderator-moderation-1024-after.png" width="420" alt="A-demo-moderator-moderation-1024-after.png"> |
| 390 | <img src="A-demo-moderator-moderation-390-before.png" width="420" alt="A-demo-moderator-moderation-390-before.png"> | <img src="A-demo-moderator-moderation-390-after.png" width="420" alt="A-demo-moderator-moderation-390-after.png"> |

## demo-parent-sectors

Demo: Parent's Sectors.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-parent-sectors-1440-before.png" width="420" alt="A-demo-parent-sectors-1440-before.png"> | <img src="A-demo-parent-sectors-1440-after.png" width="420" alt="A-demo-parent-sectors-1440-after.png"> |
| 1024 | <img src="A-demo-parent-sectors-1024-before.png" width="420" alt="A-demo-parent-sectors-1024-before.png"> | <img src="A-demo-parent-sectors-1024-after.png" width="420" alt="A-demo-parent-sectors-1024-after.png"> |
| 390 | <img src="A-demo-parent-sectors-390-before.png" width="420" alt="A-demo-parent-sectors-390-before.png"> | <img src="A-demo-parent-sectors-390-after.png" width="420" alt="A-demo-parent-sectors-390-after.png"> |

## demo-student-sectors

Demo: Student's Sectors.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-student-sectors-1440-before.png" width="420" alt="A-demo-student-sectors-1440-before.png"> | <img src="A-demo-student-sectors-1440-after.png" width="420" alt="A-demo-student-sectors-1440-after.png"> |
| 1024 | <img src="A-demo-student-sectors-1024-before.png" width="420" alt="A-demo-student-sectors-1024-before.png"> | <img src="A-demo-student-sectors-1024-after.png" width="420" alt="A-demo-student-sectors-1024-after.png"> |
| 390 | <img src="A-demo-student-sectors-390-before.png" width="420" alt="A-demo-student-sectors-390-before.png"> | <img src="A-demo-student-sectors-390-after.png" width="420" alt="A-demo-student-sectors-390-after.png"> |

## demo-teacher-sectors

Demo: Teacher's Sectors.

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-teacher-sectors-1440-before.png" width="420" alt="A-demo-teacher-sectors-1440-before.png"> | <img src="A-demo-teacher-sectors-1440-after.png" width="420" alt="A-demo-teacher-sectors-1440-after.png"> |
| 1024 | <img src="A-demo-teacher-sectors-1024-before.png" width="420" alt="A-demo-teacher-sectors-1024-before.png"> | <img src="A-demo-teacher-sectors-1024-after.png" width="420" alt="A-demo-teacher-sectors-1024-after.png"> |
| 390 | <img src="A-demo-teacher-sectors-390-before.png" width="420" alt="A-demo-teacher-sectors-390-before.png"> | <img src="A-demo-teacher-sectors-390-after.png" width="420" alt="A-demo-teacher-sectors-390-after.png"> |

## demo-visitor-ideas

Demo, Visitor: Community Ideas (screen unchanged; its sector grid comes with the plugin in Phase C).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-visitor-ideas-1440-before.png" width="420" alt="A-demo-visitor-ideas-1440-before.png"> | <img src="A-demo-visitor-ideas-1440-after.png" width="420" alt="A-demo-visitor-ideas-1440-after.png"> |
| 1024 | <img src="A-demo-visitor-ideas-1024-before.png" width="420" alt="A-demo-visitor-ideas-1024-before.png"> | <img src="A-demo-visitor-ideas-1024-after.png" width="420" alt="A-demo-visitor-ideas-1024-after.png"> |
| 390 | <img src="A-demo-visitor-ideas-390-before.png" width="420" alt="A-demo-visitor-ideas-390-before.png"> | <img src="A-demo-visitor-ideas-390-after.png" width="420" alt="A-demo-visitor-ideas-390-after.png"> |

## demo-visitor-sector

Demo, Visitor: Robots by Sector = the sector grid, published ideas only, Contribute on the sector and every field (the website's own page is one click away).

| Width | Before | After |
|---|---|---|
| 1440 | <img src="A-demo-visitor-sector-1440-before.png" width="420" alt="A-demo-visitor-sector-1440-before.png"> | <img src="A-demo-visitor-sector-1440-after.png" width="420" alt="A-demo-visitor-sector-1440-after.png"> |
| 1024 | <img src="A-demo-visitor-sector-1024-before.png" width="420" alt="A-demo-visitor-sector-1024-before.png"> | <img src="A-demo-visitor-sector-1024-after.png" width="420" alt="A-demo-visitor-sector-1024-after.png"> |
| 390 | <img src="A-demo-visitor-sector-390-before.png" width="420" alt="A-demo-visitor-sector-390-before.png"> | <img src="A-demo-visitor-sector-390-after.png" width="420" alt="A-demo-visitor-sector-390-after.png"> |

# Phase B: the data update (migration 030)

Taken the same way after migration 030 was applied to the throw-away e2e database (`portal.mjs --phase B`; 216 page views, 0 problems). A page's **before** is Phase A's after picture of it (the code without 030). Names: `B-<role>-<page>-<width>-after.png`.

## admin-schema (Phase B)

Migration 030: the tables it changes or adds, before (001-029) and after (new columns and tables in green; nothing dropped or renamed). Taken from tools/contribution-e2e/migration-030-check.mjs on a copy of the e2e data.

| Before | After |
|---|---|
| <img src="B-admin-schema-1440-before.png" width="420" alt="B-admin-schema-1440-before.png"> | <img src="B-admin-schema-1440-after.png" width="420" alt="B-admin-schema-1440-after.png"> |

## admin-row-counts (Phase B)

Migration 030 on a copy of existing data: the rows of every table before, after, after a forced second run, after the rollback and re-applied, and the 32 checks (values unchanged, identical second run, schema back after the rollback, no server error).

| Before | After |
|---|---|
| (new page) | <img src="B-admin-row-counts-1440-after.png" width="420" alt="B-admin-row-counts-1440-after.png"> |

## admin-sector-forms (Phase B)

Sector Forms with the stored data: each field's source (Admin, Added by plugin with the plugin's name), status (Active / Hidden / Archived), description; Archive and Restore; Delete only when nothing uses the field and never for a plugin's field (the button says why).

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-admin-sector-forms-1440-after.png" width="420" alt="A-admin-sector-forms-1440-after.png"> | <img src="B-admin-sector-forms-1440-after.png" width="420" alt="B-admin-sector-forms-1440-after.png"> |
| 1024 | <img src="A-admin-sector-forms-1024-after.png" width="420" alt="A-admin-sector-forms-1024-after.png"> | <img src="B-admin-sector-forms-1024-after.png" width="420" alt="B-admin-sector-forms-1024-after.png"> |
| 390 | <img src="A-admin-sector-forms-390-after.png" width="420" alt="A-admin-sector-forms-390-after.png"> | <img src="B-admin-sector-forms-390-after.png" width="420" alt="B-admin-sector-forms-390-after.png"> |

## admin-sector-forms-suggested (Phase B)

Suggested fields are records now: Approve adds the field with "Suggested by member", Edit & approve changes the name, link code or description first, Reject needs a reason.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-admin-sector-forms-suggested-1440-after.png" width="420" alt="A-admin-sector-forms-suggested-1440-after.png"> | <img src="B-admin-sector-forms-suggested-1440-after.png" width="420" alt="B-admin-sector-forms-suggested-1440-after.png"> |
| 1024 | <img src="A-admin-sector-forms-suggested-1024-after.png" width="420" alt="A-admin-sector-forms-suggested-1024-after.png"> | <img src="B-admin-sector-forms-suggested-1024-after.png" width="420" alt="B-admin-sector-forms-suggested-1024-after.png"> |
| 390 | <img src="A-admin-sector-forms-suggested-390-after.png" width="420" alt="A-admin-sector-forms-suggested-390-after.png"> | <img src="B-admin-sector-forms-suggested-390-after.png" width="420" alt="B-admin-sector-forms-suggested-390-after.png"> |

## admin-add-field (Phase B)

+ Add field: the link code is made from the name and can be changed before saving; description, icon and the starting status.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-admin-add-field-1440-after.png" width="420" alt="A-admin-add-field-1440-after.png"> | <img src="B-admin-add-field-1440-after.png" width="420" alt="B-admin-add-field-1440-after.png"> |
| 1024 | <img src="A-admin-add-field-1024-after.png" width="420" alt="A-admin-add-field-1024-after.png"> | <img src="B-admin-add-field-1024-after.png" width="420" alt="B-admin-add-field-1024-after.png"> |
| 390 | <img src="A-admin-add-field-390-after.png" width="420" alt="A-admin-add-field-390-after.png"> | <img src="B-admin-add-field-390-after.png" width="420" alt="B-admin-add-field-390-after.png"> |

## admin-field-edit (Phase B)

Edit (side drawer): name, description, icon and Active / Hidden; the link code never changes.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | (new page) | <img src="B-admin-field-edit-1440-after.png" width="420" alt="B-admin-field-edit-1440-after.png"> |
| 1024 | (new page) | <img src="B-admin-field-edit-1024-after.png" width="420" alt="B-admin-field-edit-1024-after.png"> |
| 390 | (new page) | <img src="B-admin-field-edit-390-after.png" width="420" alt="B-admin-field-edit-390-after.png"> |

## admin-audit-log (Phase B)

The Audit Log reads audit_log: every approval, publishing request, publication, rejection, field, suggestion, sector and role change, written with the change itself (here the e2e run's actions and 030's backfill).

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-admin-audit-log-1440-after.png" width="420" alt="A-admin-audit-log-1440-after.png"> | <img src="B-admin-audit-log-1440-after.png" width="420" alt="B-admin-audit-log-1440-after.png"> |
| 1024 | <img src="A-admin-audit-log-1024-after.png" width="420" alt="A-admin-audit-log-1024-after.png"> | <img src="B-admin-audit-log-1024-after.png" width="420" alt="B-admin-audit-log-1024-after.png"> |
| 390 | <img src="A-admin-audit-log-390-after.png" width="420" alt="A-admin-audit-log-390-after.png"> | <img src="B-admin-audit-log-390-after.png" width="420" alt="B-admin-audit-log-390-after.png"> |

## moderator-moderation (Phase B)

Moderation: Approve as-is is its own step now (the idea becomes Approved, blue); Edit & approve and Reject as before.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-moderator-moderation-1440-after.png" width="420" alt="A-moderator-moderation-1440-after.png"> | <img src="B-moderator-moderation-1440-after.png" width="420" alt="B-moderator-moderation-1440-after.png"> |
| 1024 | <img src="A-moderator-moderation-1024-after.png" width="420" alt="A-moderator-moderation-1024-after.png"> | <img src="B-moderator-moderation-1024-after.png" width="420" alt="B-moderator-moderation-1024-after.png"> |
| 390 | <img src="A-moderator-moderation-390-after.png" width="420" alt="A-moderator-moderation-390-after.png"> | <img src="B-moderator-moderation-390-after.png" width="420" alt="B-moderator-moderation-390-after.png"> |

## moderator-moderation-approved (Phase B)

New: an approved idea in the Approved tab with "Send publish request to Admin" (the publishing request is the next step; a Moderator never publishes).

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | (new page) | <img src="B-moderator-moderation-approved-1440-after.png" width="420" alt="B-moderator-moderation-approved-1440-after.png"> |
| 1024 | (new page) | <img src="B-moderator-moderation-approved-1024-after.png" width="420" alt="B-moderator-moderation-approved-1024-after.png"> |
| 390 | (new page) | <img src="B-moderator-moderation-approved-390-after.png" width="420" alt="B-moderator-moderation-approved-390-after.png"> |

## moderator-moderation-edit-approve (Phase B)

The drawer's main button is "Approve" (the request is sent separately).

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-moderator-moderation-edit-approve-1440-after.png" width="420" alt="A-moderator-moderation-edit-approve-1440-after.png"> | <img src="B-moderator-moderation-edit-approve-1440-after.png" width="420" alt="B-moderator-moderation-edit-approve-1440-after.png"> |
| 1024 | <img src="A-moderator-moderation-edit-approve-1024-after.png" width="420" alt="A-moderator-moderation-edit-approve-1024-after.png"> | <img src="B-moderator-moderation-edit-approve-1024-after.png" width="420" alt="B-moderator-moderation-edit-approve-1024-after.png"> |
| 390 | <img src="A-moderator-moderation-edit-approve-390-after.png" width="420" alt="A-moderator-moderation-edit-approve-390-after.png"> | <img src="B-moderator-moderation-edit-approve-390-after.png" width="420" alt="B-moderator-moderation-edit-approve-390-after.png"> |

## admin-publish-requests (Phase B)

Publish Requests lists only what a Moderator sent (an approved idea waits with its Moderator).

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-admin-publish-requests-1440-after.png" width="420" alt="A-admin-publish-requests-1440-after.png"> | <img src="B-admin-publish-requests-1440-after.png" width="420" alt="B-admin-publish-requests-1440-after.png"> |
| 1024 | <img src="A-admin-publish-requests-1024-after.png" width="420" alt="A-admin-publish-requests-1024-after.png"> | <img src="B-admin-publish-requests-1024-after.png" width="420" alt="B-admin-publish-requests-1024-after.png"> |
| 390 | <img src="A-admin-publish-requests-390-after.png" width="420" alt="A-admin-publish-requests-390-after.png"> | <img src="B-admin-publish-requests-390-after.png" width="420" alt="B-admin-publish-requests-390-after.png"> |

## admin-sectors (Phase B)

Sectors: Rename, Move up / down, Card style and Archive (or Restore) work now; + Add sector at the top.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-admin-sectors-1440-after.png" width="420" alt="A-admin-sectors-1440-after.png"> | <img src="B-admin-sectors-1440-after.png" width="420" alt="B-admin-sectors-1440-after.png"> |
| 1024 | <img src="A-admin-sectors-1024-after.png" width="420" alt="A-admin-sectors-1024-after.png"> | <img src="B-admin-sectors-1024-after.png" width="420" alt="B-admin-sectors-1024-after.png"> |
| 390 | <img src="A-admin-sectors-390-after.png" width="420" alt="A-admin-sectors-390-after.png"> | <img src="B-admin-sectors-390-after.png" width="420" alt="B-admin-sectors-390-after.png"> |

## admin-add-sector (Phase B)

New: + Add sector (name; icon and colour for its card).

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | (new page) | <img src="B-admin-add-sector-1440-after.png" width="420" alt="B-admin-add-sector-1440-after.png"> |
| 1024 | (new page) | <img src="B-admin-add-sector-1024-after.png" width="420" alt="B-admin-add-sector-1024-after.png"> |
| 390 | (new page) | <img src="B-admin-add-sector-390-after.png" width="420" alt="B-admin-add-sector-390-after.png"> |

## admin-users-roles (Phase B)

Users & Roles: a moderator's sectors ("Reviews: every sector") with Edit sectors.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-admin-users-roles-1440-after.png" width="420" alt="A-admin-users-roles-1440-after.png"> | <img src="B-admin-users-roles-1440-after.png" width="420" alt="B-admin-users-roles-1440-after.png"> |
| 1024 | <img src="A-admin-users-roles-1024-after.png" width="420" alt="A-admin-users-roles-1024-after.png"> | <img src="B-admin-users-roles-1024-after.png" width="420" alt="B-admin-users-roles-1024-after.png"> |
| 390 | <img src="A-admin-users-roles-390-after.png" width="420" alt="A-admin-users-roles-390-after.png"> | <img src="B-admin-users-roles-390-after.png" width="420" alt="B-admin-users-roles-390-after.png"> |

## admin-users-edit-sectors (Phase B)

New: Edit sectors (none ticked = every sector). The server limits that moderator's Moderation, items and actions to those sectors.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | (new page) | <img src="B-admin-users-edit-sectors-1440-after.png" width="420" alt="B-admin-users-edit-sectors-1440-after.png"> |
| 1024 | (new page) | <img src="B-admin-users-edit-sectors-1024-after.png" width="420" alt="B-admin-users-edit-sectors-1024-after.png"> |
| 390 | (new page) | <img src="B-admin-users-edit-sectors-390-after.png" width="420" alt="B-admin-users-edit-sectors-390-after.png"> |

## demo-moderator-moderation (Phase B)

Demo: the same two steps (Approve, then Send publish request to Admin).

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-demo-moderator-moderation-1440-after.png" width="420" alt="A-demo-moderator-moderation-1440-after.png"> | <img src="B-demo-moderator-moderation-1440-after.png" width="420" alt="B-demo-moderator-moderation-1440-after.png"> |
| 1024 | <img src="A-demo-moderator-moderation-1024-after.png" width="420" alt="A-demo-moderator-moderation-1024-after.png"> | <img src="B-demo-moderator-moderation-1024-after.png" width="420" alt="B-demo-moderator-moderation-1024-after.png"> |
| 390 | <img src="A-demo-moderator-moderation-390-after.png" width="420" alt="A-demo-moderator-moderation-390-after.png"> | <img src="B-demo-moderator-moderation-390-after.png" width="420" alt="B-demo-moderator-moderation-390-after.png"> |

## demo-admin-sector-forms (Phase B)

Demo: Sector Forms with archive, delete when unused and stored suggestions.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-demo-admin-sector-forms-1440-after.png" width="420" alt="A-demo-admin-sector-forms-1440-after.png"> | <img src="B-demo-admin-sector-forms-1440-after.png" width="420" alt="B-demo-admin-sector-forms-1440-after.png"> |
| 1024 | <img src="A-demo-admin-sector-forms-1024-after.png" width="420" alt="A-demo-admin-sector-forms-1024-after.png"> | <img src="B-demo-admin-sector-forms-1024-after.png" width="420" alt="B-demo-admin-sector-forms-1024-after.png"> |
| 390 | <img src="A-demo-admin-sector-forms-390-after.png" width="420" alt="A-demo-admin-sector-forms-390-after.png"> | <img src="B-demo-admin-sector-forms-390-after.png" width="420" alt="B-demo-admin-sector-forms-390-after.png"> |

## demo-admin-sectors-admin (Phase B)

Demo: Sectors with every action.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-demo-admin-sectors-admin-1440-after.png" width="420" alt="A-demo-admin-sectors-admin-1440-after.png"> | <img src="B-demo-admin-sectors-admin-1440-after.png" width="420" alt="B-demo-admin-sectors-admin-1440-after.png"> |
| 1024 | <img src="A-demo-admin-sectors-admin-1024-after.png" width="420" alt="A-demo-admin-sectors-admin-1024-after.png"> | <img src="B-demo-admin-sectors-admin-1024-after.png" width="420" alt="B-demo-admin-sectors-admin-1024-after.png"> |
| 390 | <img src="A-demo-admin-sectors-admin-390-after.png" width="420" alt="A-demo-admin-sectors-admin-390-after.png"> | <img src="B-demo-admin-sectors-admin-390-after.png" width="420" alt="B-demo-admin-sectors-admin-390-after.png"> |

## demo-admin-users (Phase B)

Demo: Users & Roles with Edit sectors for the moderator.

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-demo-admin-users-1440-after.png" width="420" alt="A-demo-admin-users-1440-after.png"> | <img src="B-demo-admin-users-1440-after.png" width="420" alt="B-demo-admin-users-1440-after.png"> |
| 1024 | <img src="A-demo-admin-users-1024-after.png" width="420" alt="A-demo-admin-users-1024-after.png"> | <img src="B-demo-admin-users-1024-after.png" width="420" alt="B-demo-admin-users-1024-after.png"> |
| 390 | <img src="A-demo-admin-users-390-after.png" width="420" alt="A-demo-admin-users-390-after.png"> | <img src="B-demo-admin-users-390-after.png" width="420" alt="B-demo-admin-users-390-after.png"> |

## demo-admin-audit (Phase B)

Demo: the Audit Log with the new kinds (publish requested, field, suggestion, sector and role changes).

| Width | Before (Phase A) | After (Phase B) |
|---|---|---|
| 1440 | <img src="A-demo-admin-audit-1440-after.png" width="420" alt="A-demo-admin-audit-1440-after.png"> | <img src="B-demo-admin-audit-1440-after.png" width="420" alt="B-demo-admin-audit-1440-after.png"> |
| 1024 | <img src="A-demo-admin-audit-1024-after.png" width="420" alt="A-demo-admin-audit-1024-after.png"> | <img src="B-demo-admin-audit-1024-after.png" width="420" alt="B-demo-admin-audit-1024-after.png"> |
| 390 | <img src="A-demo-admin-audit-390-after.png" width="420" alt="A-demo-admin-audit-390-after.png"> | <img src="B-demo-admin-audit-390-after.png" width="420" alt="B-demo-admin-audit-390-after.png"> |

## admin-sectors-archive-dialog (Phase B)

Fix: opened directly, Admin > Sectors showed "Archive <sector>?" (and Rename) as plain text under the page, with no backdrop (before); the page now loads the dialogs' styles, so it opens over the page (after). The sidebar is cut off: both pictures were taken on the Phase C build, whose sidebar also has Plugins; the Sectors page is the same code.

| Before | After |
|---|---|
| <img src="B-admin-sectors-archive-dialog-1440-before.png" width="420" alt="B-admin-sectors-archive-dialog-1440-before.png"> | <img src="B-admin-sectors-archive-dialog-1440-after.png" width="420" alt="B-admin-sectors-archive-dialog-1440-after.png"> |

