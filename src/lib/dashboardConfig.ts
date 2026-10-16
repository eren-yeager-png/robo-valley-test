// Role -> dashboard definition. Pure data, shared by server components and tests.
//
// IMPORTANT: none of the sections below has a backend yet (the database only has `users` and
// `guardian_details`). Each section therefore renders an honest empty state, and `needs` names the
// schema/API that must exist before it can show real data. Nothing here is a metric.

import { GROUPS, ROLE_CODES, ROLES } from "./roles";
import { VALUE } from "./roleValue";

export type Section = { slug: string; label: string; description: string; needs: string };
export type RoleDashboard = {
  code: string;
  label: string;
  hint: string;
  group: string;
  tagline: string;
  /** Labels of the headline tiles. They are shown as "not available yet", never with numbers. */
  tiles: string[];
  sections: Section[];
  /** Quick actions link to the role's own sections (or the profile). */
  quickActions: Array<{ label: string; href: string }>;
};

const s = (slug: string, label: string, description: string, needs: string): Section => ({ slug, label, description, needs });

const SECTIONS: Record<string, { tiles: string[]; sections: Section[]; actions: Array<[string, string]> }> = {
  ST: {
    tiles: ["Projects in progress", "Badges earned", "Mentor sessions", "Next competition"],
    sections: [
      s("projects", "Projects", "Projects matched to your class and your school's kits.", "projects, project_steps and student_project_progress tables, plus school kit inventory"),
      s("mentors", "Mentors", "Book free help from verified mentors.", "mentor availability, session booking and verified-mentor tables"),
      s("clubs", "Clubs & teams", "Join clubs and project teams across schools.", "teams, team_members and invitations tables"),
      s("competitions", "Competitions", "Competitions and events you can enter.", "competitions, registrations and team-entry tables"),
      s("portfolio", "Portfolio & certificates", "Badges, certificates and projects colleges and employers can check.", "portfolio_items, badges and certificates tables with a verification flow"),
    ],
    actions: [["Find a project", "/dashboard/projects"], ["Book a mentor", "/dashboard/mentors"]],
  },
  PA: {
    tiles: ["Linked children", "Upcoming events", "Courses compared", "Consent status"],
    sections: [
      s("children", "My child", "Your child's progress, badges and activity.", "a parent_child_links table where the child's account is verified and linked with consent (today guardian_details stores only the guardian's contact details)"),
      s("events", "Upcoming events", "Events and holiday camps near you.", "events and event_registrations tables"),
      s("courses", "Courses & fees", "Compare course fees and ratings.", "courses, course_fees and ratings tables"),
      s("consent", "Consent & controls", "See and manage the consent you have given for your child.", "guardian consent records linked to a parent user account, plus a real (non-test) consent workflow"),
    ],
    actions: [["Link your child", "/dashboard/children"], ["Compare courses", "/dashboard/courses"]],
  },
  TC: {
    tiles: ["Students in your labs", "Lab hours used", "Teams registered", "Trainings due"],
    sections: [
      s("lessons", "Lesson plans", "Ready lessons matched to your lab's kits.", "lessons and lesson_kit_requirements tables"),
      s("kits", "Lab kits", "Your lab's kits and their status; report faults.", "schools, labs, kit_inventory and fault_reports tables"),
      s("teams", "Student teams", "Teams you coach and their progress.", "teams and team_members tables scoped to your school"),
      s("mentors", "Mentor support", "Mentors and trainers who support your classes.", "mentor requests and session tables"),
      s("training", "Teacher training", "Training courses and certificates.", "courses and enrolments tables"),
      s("competitions", "Competitions", "Register your school's teams.", "competitions and team-registration tables"),
    ],
    actions: [["Add your lab's kits", "/dashboard/kits"], ["Plan a lesson", "/dashboard/lessons"]],
  },
  SA: {
    tiles: ["Students joined", "Teachers active", "Lab utilisation", "Partner offers"],
    sections: [
      s("school", "School profile", "Your school's profile and verification status.", "schools and school_admins tables with a UDISE verification workflow (today the school name and UDISE code are only self-declared in your profile)"),
      s("people", "Teachers & students", "Invite and manage the people at your school.", "school_members and bulk-invite tables restricted to your school"),
      s("labs", "Lab utilisation", "How your labs are used.", "lab_sessions and lab_usage tables"),
      s("reports", "Participation reports", "Participation and results you can share.", "participation aggregates scoped to your school"),
      s("partners", "Partnerships", "CSR, trainer and partner offers for your school.", "partner_offers and sponsorship tables"),
    ],
    actions: [["Complete school details", "/dashboard/profile"], ["Invite teachers", "/dashboard/people"]],
  },
  MG: {
    tiles: ["Schools onboarded", "Average lab use", "Idle labs", "Teachers trained"],
    sections: [
      s("schools", "Schools in scope", "The schools you are authorised to oversee.", "an org_scopes / school_assignments table that records which schools each official may see"),
      s("districts", "District participation", "Participation by district.", "participation aggregates limited to your assigned scope"),
      s("labs", "Lab utilisation", "Which labs are idle and why.", "lab_usage tables plus scope enforcement"),
      s("programmes", "Programme progress", "Programme partners and CSR in one place.", "programmes and partner tables"),
    ],
    actions: [["Complete your office details", "/dashboard/profile"], ["See schools in scope", "/dashboard/schools"]],
  },
  ME: {
    tiles: ["Requests waiting", "Sessions this month", "Average rating", "Hours offered"],
    sections: [
      s("requests", "Mentoring requests", "Requests matched to your subjects.", "mentor_requests and request-matching tables"),
      s("availability", "Subjects & availability", "Your subjects, slots and monthly limits.", "mentor_subjects and mentor_availability tables (today only your self-declared subjects are in your profile)"),
      s("sessions", "Upcoming sessions", "Your booked sessions.", "mentoring_sessions table"),
      s("feedback", "Feedback & ratings", "Ratings from learners.", "session_ratings table with moderation"),
    ],
    actions: [["Set your subjects", "/dashboard/profile"], ["See requests", "/dashboard/requests"]],
  },
  TR: {
    tiles: ["Enrolments", "Course rating", "School enquiries", "Courses listed"],
    sections: [
      s("courses", "Courses & workshops", "List and manage your courses.", "courses, schedules and fees tables"),
      s("enquiries", "Enquiries", "Enquiries from schools and learners.", "enquiries table with an access rule limiting each trainer to their own"),
      s("demand", "Demand by district & subject", "Where learners need courses.", "privacy-safe demand aggregates"),
      s("ratings", "Ratings", "Ratings from verified learners.", "course_ratings table"),
    ],
    actions: [["List a course", "/dashboard/courses"], ["Check enquiries", "/dashboard/enquiries"]],
  },
  AR: {
    tiles: ["Craft portfolio items", "Heritage-tech projects", "Maker collaborations", "Opportunities"],
    sections: [
      s("portfolio", "Craft portfolio", "Show your craft or art form.", "portfolio_items table with image storage"),
      s("projects", "Heritage-tech projects", "Projects that add motion, light or sound to a craft.", "projects and project_members tables"),
      s("collaborations", "Maker collaborations", "Meet and work with maker teams.", "collaboration requests and team tables"),
      s("opportunities", "Product opportunities", "New products, buyers and audiences.", "opportunities / listings tables"),
    ],
    actions: [["Describe your craft", "/dashboard/profile"], ["Show your portfolio", "/dashboard/portfolio"]],
  },
  KS: {
    tiles: ["Schools using your kits", "Open fault reports", "Product rating", "Kits listed"],
    sections: [
      s("catalogue", "Kit catalogue", "Your kits and components.", "products and product_specs tables"),
      s("demand", "School demand", "Demand by kit type and district.", "privacy-safe demand aggregates"),
      s("matches", "Project matching", "Link your kits to ready projects.", "project_kit_links table"),
      s("lending", "Lending & donations", "Kit lending, refurbishing and donation programmes.", "lending_programmes and donations tables"),
      s("faults", "Fault reports", "Reports from schools about your kits.", "fault_reports table visible only to the supplier of the kit"),
    ],
    actions: [["Add your catalogue", "/dashboard/catalogue"], ["Check fault reports", "/dashboard/faults"]],
  },
  FS: {
    tiles: ["Orders", "Machines listed", "Service rating", "Open requests"],
    sections: [
      s("services", "Services", "Printing, cutting and making services you offer.", "services table"),
      s("machines", "Machines & availability", "Your machines and when they can be booked.", "machines and availability tables"),
      s("bookings", "Bookings & orders", "Requests and orders from makers.", "bookings table with an access rule limiting each provider to their own"),
      s("ratings", "Customer ratings", "Ratings from customers.", "service_ratings table"),
    ],
    actions: [["List your services", "/dashboard/profile"], ["Check bookings", "/dashboard/bookings"]],
  },
  SP: {
    tiles: ["Schools funded", "Learners reached", "Teams supported", "Open funding needs"],
    sections: [
      s("needs", "Funding needs", "School funding needs by district.", "funding_needs table with school verification"),
      s("funded", "Supported projects", "What you have funded and its status.", "pledges and fulfilment tables"),
      s("outcomes", "Outcomes", "Measurable results of what you funded.", "outcome metrics tied to funded items"),
      s("reports", "Impact reports", "Reports you can share.", "report generation over verified outcome data"),
    ],
    actions: [["Set your CSR focus", "/dashboard/profile"], ["Browse funding needs", "/dashboard/needs"]],
  },
  IP: {
    tiles: ["Portfolios matching your skills", "Problem statements live", "Applications", "Shortlisted"],
    sections: [
      s("talent", "Student portfolios & skills", "Verified student portfolios by skill.", "portfolio tables plus student opt-in consent for sharing with partners (and guardian consent for minors)"),
      s("problems", "Problem statements", "Post problems for students to solve.", "problem_statements table"),
      s("internships", "Internships", "Internships and applications.", "internships and applications tables"),
      s("collaborations", "Collaborations", "Work with schools and colleges.", "collaboration tables"),
      s("shortlist", "Talent shortlist", "Candidates you have shortlisted.", "shortlist table with consent checks"),
    ],
    actions: [["Describe what you need", "/dashboard/profile"], ["Post a problem", "/dashboard/problems"]],
  },
};

const groupOf = (code: string) => GROUPS.find(([, codes]) => codes.includes(code))?.[0] ?? "";

export const ROLE_DASHBOARDS: Record<string, RoleDashboard> = Object.fromEntries(
  ROLES.map(([code, label, hint]) => {
    const c = SECTIONS[code];
    return [
      code,
      {
        code, label, hint, group: groupOf(code), tagline: VALUE[code][0],
        tiles: c.tiles, sections: c.sections,
        quickActions: c.actions.map(([l, href]) => ({ label: l, href })),
      } satisfies RoleDashboard,
    ];
  })
);

/** Dashboard definition for a role code, or null for a missing/unknown role (own keys only). */
export function getRoleDashboard(role: unknown): RoleDashboard | null {
  return typeof role === "string" && ROLE_CODES.includes(role) ? ROLE_DASHBOARDS[role] : null;
}

/** Slugs that belong to the role. Anything else must be refused for that role. */
export const sectionOf = (role: unknown, slug: string): Section | null =>
  getRoleDashboard(role)?.sections.find((x) => x.slug === slug) ?? null;

/** True if the slug is a real section for at least one role (used to tell "forbidden" from "not found"). */
export const isKnownSectionSlug = (slug: string) => Object.values(ROLE_DASHBOARDS).some((r) => r.sections.some((x) => x.slug === slug));

/** Fixed (non role-specific) dashboard pages. Section slugs must never collide with these. */
export const RESERVED_SLUGS = ["profile", "notifications"] as const;
