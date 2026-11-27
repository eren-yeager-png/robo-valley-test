// Contribution workflow: the STANDALONE DEMO's sample data only (never used by the plugin or the app). The demo's three samples plus
// more, one per status, created through the mock adapter's own actions so every history line is what production would write.
export async function seed(mock) {
  const mod = mock.as("moderator"), adm = mock.as("admin");
  const base = { refers: false, sector: "not-sure", robotType: "not-sure", categories: [], suitableFor: [], learningPath: "", references: [] };
  const add = async (who, data, file = null) => (await mock.submit({ ...base, ...data }, file, who)).id;
  const item = async (id) => (await mock.detail(id)).item;
  const open = (id) => mod.act(id, "open");
  const send = async (id, edits = {}, notes = "") => {
    const it = await item(id);
    return mod.act(id, "send_request", { rowVersion: it.rowVersion, proposed: { ...it.proposed, ...edits }, notes });
  };
  const preview = async (id) => { const it = await item(id); return adm.act(id, "preview", { rowVersion: it.rowVersion, version: it.versions.length }); };
  const publish = async (id) => adm.publish(id, { rowVersion: (await item(id)).rowVersion });
  const changes = async (id, text) => adm.act(id, "request_changes", { rowVersion: (await item(id)).rowVersion, feedback: text });

  // the demo's three samples
  await add({ name: "Student User", type: "Student" }, {
    kind: "New idea", title: "Smart Irrigation System", sector: "agriculture-dairy", categories: ["STEAM", "Robotics"], suitableFor: ["K6–K8", "K9–K10"], learningPath: "Make",
    description: "A system that automatically waters plants based on soil moisture.",
  }, { name: "irrigation-sketch.png", type: "image/png", size: 182000 });
  const meera = await add({ name: "Meera K.", type: "Parent / guardian" }, {
    kind: "New idea", title: "Medicine reminder robot for grandparents", sector: "healthcare", categories: ["Robotics", "Physical AI and AI"], suitableFor: ["Diploma", "Engineering"], learningPath: "Build",
    description: "A small robot at home that reminds elderly people to take medicine on time and alerts family if they miss it.",
  });
  const rao = await add({ name: "Dr. S. Rao", type: "Mentor / subject expert" }, {
    kind: "Enhancement of existing feature", title: "Add cost band and where to see weeding robots working", sector: "agriculture-dairy", robotType: "weeding-robots",
    description: "Add a cost band and a list of farms, universities or labs where farmers and students can see a weeding robot in use.",
    categories: ["Robotics"], suitableFor: ["ITI", "Diploma", "Engineering"], learningPath: "Learn",
    resource: { feature: "Robots by Sector", type: "Robot type", path: "Robots by Sector › Agriculture & Dairy › Weeding robots", url: "https://techytree.in/robots-by-sector/agriculture-dairy/#rv-type-weeding-robots", change: "The card explains what weeding robots do but not what they cost or where to see one working." },
    references: [{ url: "https://techytree.in/robots-by-sector/agriculture-dairy/", remarks: "Current Agriculture & Dairy page, for comparison" }],
  });
  // one more for every other status
  const kiran = await add({ name: "Kiran P.", type: "Teacher / lab in-charge" }, {
    kind: "New idea", title: "Robot lawn mower for the school ground", sector: "education", categories: ["STEAM"], suitableFor: ["K9–K10"],
    description: "Students build a slow, safe robot mower with bump sensors that keeps the school ground tidy.",
  });
  const farah = await add({ name: "Farah N.", type: "Student", minor: true }, {
    kind: "Suggestion", title: "Step-by-step robot arm kit guide for class 8", sector: "education", robotType: "robotic-arms", categories: ["Robotics"], suitableFor: ["K6–K8"], learningPath: "Learn",
    description: "A printable guide that walks a class 8 group through assembling the robot arm kit in four lessons.",
    resource: { feature: "STEAM Kits", type: "Kit", path: "STEAM Kits › Robot arm kit", url: "", change: "There is no lesson plan for the robot arm kit yet." },
  });
  const ravi = await add({ name: "Ravi T.", type: "Kit maker / supplier" }, {
    kind: "New idea", title: "Drone survey for crop health", sector: "agriculture-dairy", robotType: "drone-sprayers", categories: ["Robotics", "Physical AI and AI"], suitableFor: ["Diploma", "Engineering"], learningPath: "Earn (18+)",
    description: "Use a small drone with a camera to spot unhealthy patches in a field and plan where to spray.",
  });
  const asha = await add({ name: "Asha M.", type: "Teacher / lab in-charge" }, {
    kind: "New idea", title: "Delivery robot for hospital corridors", sector: "healthcare", robotType: "delivery-robots", categories: ["Robotics"], suitableFor: ["Engineering", "Advanced"], learningPath: "Build",
    description: "A robot that carries medicines and samples between wards so nurses spend less time walking.",
    references: [{ url: "https://example.com/hospital-robots", remarks: "Article about delivery robots in hospitals" }],
  });
  const neha = await add({ name: "Neha S.", type: "Student", minor: true }, {
    kind: "New idea", title: "Beach clean-up robot challenge", categories: ["STEAM", "Re-engineering"], suitableFor: ["K6–K8", "K9–K10"], learningPath: "Make",
    description: "A school challenge where teams rebuild old toy cars into robots that collect plastic from a sand pit.",
  });
  const imran = await add({ name: "Imran K.", type: "College / industry partner" }, {
    kind: "New idea", title: "Sorting robot for recycling", sector: "manufacturing", robotType: "cobots", categories: ["Robotics", "Physical AI and AI"], suitableFor: ["Engineering"], learningPath: "Build",
    description: "A camera and a small arm that sort cans, bottles and paper on a conveyor belt at a recycling centre.",
  });
  const sam = await add({ name: "Sam W.", type: "Student" }, {
    kind: "New idea", title: "Robot that does my homework", categories: ["Physical AI and AI"],
    description: "A robot that writes all my homework for me every evening.",
  });

  await open(meera);                                                                                        // Under Moderator Review
  await send(rao, {}, "Clear request; approved as-is.");                                                    // Pending Admin Approval
  await open(kiran);
  { const it = await item(kiran); await mod.act(kiran, "save_draft", { rowVersion: it.rowVersion, proposed: { ...it.proposed, title: "Safe robot lawn mower for the school ground", categories: ["STEAM", "Robotics"] }, notes: "Clarified the title." }); } // Moderator Draft
  await open(farah); await send(farah, { description: "A printable guide that walks a class 8 group through assembling the robot arm kit in four short lessons." });
  await changes(farah, "Please say which robot arm kit this is for and add a photo of the finished arm.");   // Changes Requested
  await open(ravi); await send(ravi, {}, "Good idea.");
  await changes(ravi, "Earn (18+) is for adults; is this meant for students?");
  { const it = await item(ravi); await mod.act(ravi, "send_request", { rowVersion: it.rowVersion, proposed: { ...it.proposed, learningPath: "Learn", suitableFor: ["Diploma"] }, notes: "Changed the path to Learn." }); } // Resubmitted
  await open(asha); await send(asha, { title: "Delivery robot for hospital corridors and wards" }, "Small title edit."); await preview(asha); await publish(asha); // Published
  await open(neha); await send(neha); await preview(neha); await publish(neha);                            // Published (Other ideas)
  await open(imran); await send(imran); await preview(imran); mock.failNext = true; await publish(imran);   // Publication Failed
  await open(sam);
  { const it = await item(sam); await mod.act(sam, "decline", { rowVersion: it.rowVersion, reason: "Not a contribution to RoboValley: it asks for a robot to do homework." }); } // Rejected
}
