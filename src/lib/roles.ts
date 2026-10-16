// Shared by the signup UI and the server so both agree on roles and profile questions.
// Mirrors ROLES / GROUPS / ROLE_FIELDS in Flow.html.

export const ROLES: ReadonlyArray<readonly [string, string, string]> = [
  ["ST", "Student", "School, ITI, polytechnic or college"],
  ["PA", "Parent / guardian", "Follow your child's learning"],
  ["TC", "Teacher / lab in-charge", "Run tinkering or science classes"],
  ["SA", "School administrator", "Principal or school admin"],
  ["MG", "Management / education official", "Oversee several schools"],
  ["ME", "Mentor / subject expert", "Guide young makers"],
  ["TR", "Trainer / course provider", "Offer courses and workshops"],
  ["AR", "Artisan / traditional artist", "Bring your craft or art form"],
  ["KS", "Kit maker / supplier", "STEM kits and components"],
  ["FS", "3D printing / fabrication service", "Printing and making services"],
  ["SP", "CSR sponsor", "Fund labs, kits and makers"],
  ["IP", "College / industry partner", "Find talent, share problems"],
];

export const ROLE_CODES: string[] = ROLES.map((r) => r[0]);

export const GROUPS: ReadonlyArray<readonly [string, string[]]> = [
  ["Learners & families", ["ST", "PA"]],
  ["Schools", ["TC", "SA", "MG"]],
  ["Partners & providers", ["ME", "TR", "AR", "KS", "FS", "SP", "IP"]],
];

export const LANGUAGES = ["Telugu", "English", "Hindi"] as const;
export const GUARDIAN_RELATIONSHIPS = ["Mother", "Father", "Guardian", "Other"] as const;
export const MINOR_ALLOWED_ROLES = ["ST"];

export type ProfileField =
  | { key: string; type: "txt"; label: string; hint: string; required: boolean }
  | { key: string; type: "sel" | "chips"; label: string; options: string[]; required: boolean };

const txt = (key: string, label: string, hint: string, required: boolean): ProfileField => ({
  key, type: "txt", label, hint, required,
});
const sel = (key: string, label: string, options: string[], required: boolean): ProfileField => ({
  key, type: "sel", label, options, required,
});
const chips = (key: string, label: string, options: string[], required: boolean): ProfileField => ({
  key, type: "chips", label, options, required,
});

export const ROLE_FIELDS: Record<string, ProfileField[]> = {
  ST: [
    sel("class", "Class or course", ["Class 6–8", "Class 9–10", "Class 11–12", "ITI", "Polytechnic", "Degree / B.Tech", "Other"], true),
    txt("school", "School or college name", "", true),
    txt("udise", "School UDISE code", "11 digits, if you know it", false),
    chips("interests", "Interested in", ["Robotics", "Electronics", "Coding", "AI", "Drones", "3D design", "Heritage crafts + tech"], false),
  ],
  PA: [
    txt("childName", "Your child's name", "", true),
    txt("childContact", "Child's mobile number or invite code", "To link your accounts", false),
    chips("wantToSee", "You want to see", ["Progress and badges", "Events near me", "Courses and fees", "Holiday camps"], false),
  ],
  TC: [
    txt("school", "School name", "", true),
    txt("schoolCode", "School UDISE or ATL code", "", true),
    chips("subjects", "Subjects you teach", ["Science", "Maths", "Computers", "ATL / tinkering", "Vocational"], true),
  ],
  SA: [
    txt("school", "School name", "", true),
    txt("udise", "School UDISE code", "", true),
    sel("designation", "Your designation", ["Principal", "Headmaster", "School admin", "Other"], true),
    txt("studentCount", "Number of students (approx.)", "", false),
  ],
  MG: [
    txt("organisation", "Organisation or office", "", true),
    sel("designation", "Your designation", ["Trust / management", "Education official", "Programme manager", "Other"], true),
    txt("schoolCount", "Number of schools you oversee", "", false),
  ],
  ME: [
    chips("subjects", "Your subjects", ["Robotics", "Embedded", "Electronics", "Coding", "AI / ML", "Mechanical", "Drones", "Design"], true),
    sel("experience", "Experience", ["Student (senior)", "1–5 years", "5–15 years", "15+ years / retired"], true),
    sel("hoursPerMonth", "Hours you can give per month", ["1–2", "3–5", "6–10", "10+"], true),
    chips("languages", "Language", ["Telugu", "English", "Hindi"], false),
  ],
  TR: [
    txt("nameOrOrg", "Your name or organisation", "", true),
    txt("courses", "Courses you offer", "e.g. Arduino basics, drone workshop", true),
    sel("mode", "Mode", ["Online", "In person", "Both"], true),
  ],
  AR: [
    txt("craft", "Your craft or art form", "e.g. lacquer toys, classical dance, weaving", true),
    txt("town", "Town or village", "", false),
    chips("interests", "You are interested in", ["Adding motion / light / sound", "New products and markets", "Teaching makers", "Performances with robots"], false),
  ],
  KS: [
    txt("company", "Company name", "", true),
    chips("supplies", "What you supply", ["Robotics kits", "Sensors and electronics", "Mechanical parts", "Drones", "3D printers / filament", "Lab furniture"], true),
    chips("openTo", "Open to", ["Kit lending", "Refurbishing old kits", "Donating kits"], false),
  ],
  FS: [
    txt("business", "Business or lab name", "", true),
    chips("services", "Services", ["3D printing", "Laser cutting", "PCB making", "CNC", "Design help"], true),
    txt("town", "Town / district", "", false),
  ],
  SP: [
    txt("company", "Company or foundation", "", true),
    chips("focus", "CSR focus", ["School labs", "Kits", "Mobile labs", "Competitions", "Girls in STEM", "Rural reach"], true),
    txt("designation", "Contact person's designation", "", false),
  ],
  IP: [
    txt("organisation", "Organisation name", "", true),
    sel("type", "Type", ["Engineering college", "ITI / polytechnic", "Company", "Startup"], true),
    txt("skills", "Skills you are looking for", "", false),
  ],
};
