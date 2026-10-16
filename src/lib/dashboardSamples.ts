// EXAMPLE DATA ONLY. Copied from Roles.html (the product prototype). None of this is live or comes from
// the database; the dashboard shows it only inside a block labelled "sample data".
// AR (artisan) and FS (fabrication service) have no sample in Roles.html, so they have none here.

export type SampleCard = { title: string; items: Array<{ title: string; detail: string; action: string }> };
export type RoleSample = { kpis: Array<[string, string]>; cards: SampleCard[] };

export const ROLE_SAMPLES: Record<string, RoleSample> = {
  "ST": {
    "kpis": [
      [
        "3",
        "projects in progress"
      ],
      [
        "2",
        "badges earned"
      ],
      [
        "14",
        "days to RoboCity League"
      ],
      [
        "1",
        "mentor session booked"
      ]
    ],
    "cards": [
      {
        "title": "Suitable projects",
        "items": [
          {
            "title": "Line-follower robot",
            "detail": "Arduino kit in your ATL · Level 2",
            "action": "Start"
          },
          {
            "title": "Smart dustbin",
            "detail": "Ultrasonic sensor · Level 1",
            "action": "Start"
          },
          {
            "title": "Plant-watering alarm",
            "detail": "Soil sensor · Level 2",
            "action": "Start"
          }
        ]
      },
      {
        "title": "Mentors for you",
        "items": [
          {
            "title": "Ravi K., embedded engineer",
            "detail": "Free · Sat 10:00 online",
            "action": "Book"
          },
          {
            "title": "Priya S., B.Tech robotics",
            "detail": "Free · Sun 16:00 online",
            "action": "Book"
          }
        ]
      },
      {
        "title": "Competitions",
        "items": [
          {
            "title": "RoboCity League · district round",
            "detail": "your district · team of 3 · closes in 14 days",
            "action": "Join"
          },
          {
            "title": "ATL Marathon",
            "detail": "National · idea stage",
            "action": "View"
          }
        ]
      },
      {
        "title": "Courses",
        "items": [
          {
            "title": "Block coding to Arduino",
            "detail": "6 sessions · Telugu / English",
            "action": "Enrol"
          },
          {
            "title": "Intro to AI for school",
            "detail": "4 sessions · free",
            "action": "Enrol"
          }
        ]
      },
      {
        "title": "Kits available at your school",
        "items": [
          {
            "title": "Arduino starter kit ×10",
            "detail": "4 free this week",
            "action": "Reserve"
          },
          {
            "title": "3D printer",
            "detail": "Booked till Thursday",
            "action": "Wait-list"
          }
        ]
      },
      {
        "title": "Team up",
        "items": [
          {
            "title": "Looking for a coder",
            "detail": "Team 'AgriBots', Class 9",
            "action": "Ask"
          },
          {
            "title": "Drone club starting",
            "detail": "nearby town · open to all schools",
            "action": "Join"
          }
        ]
      }
    ]
  },
  "PA": {
    "kpis": [
      [
        "5",
        "sessions this month"
      ],
      [
        "2",
        "badges earned"
      ],
      [
        "1",
        "event coming up"
      ],
      [
        "₹0",
        "spent so far"
      ]
    ],
    "cards": [
      {
        "title": "Your child's progress",
        "items": [
          {
            "title": "Line-follower robot",
            "detail": "Step 3 of 5",
            "action": "View"
          },
          {
            "title": "Badge: First circuit",
            "detail": "Earned last week",
            "action": "View"
          }
        ]
      },
      {
        "title": "Upcoming",
        "items": [
          {
            "title": "RoboCity League district round",
            "detail": "Sat 12 Dec · your district",
            "action": "Details"
          }
        ]
      },
      {
        "title": "Courses",
        "items": [
          {
            "title": "Summer robotics camp",
            "detail": "10 days · ₹1,500 · rated 4.6",
            "action": "Compare"
          },
          {
            "title": "Intro to AI",
            "detail": "Free · 4 sessions",
            "action": "Compare"
          }
        ]
      }
    ]
  },
  "TC": {
    "kpis": [
      [
        "126",
        "students in your labs"
      ],
      [
        "68%",
        "lab hours used"
      ],
      [
        "4",
        "teams registered"
      ],
      [
        "2",
        "trainings due"
      ]
    ],
    "cards": [
      {
        "title": "Lessons for this week",
        "items": [
          {
            "title": "Sensors & alarms (Class 7)",
            "detail": "45 min · uses Arduino kit",
            "action": "Open"
          },
          {
            "title": "Intro to drones (Class 9)",
            "detail": "2 periods · video + demo",
            "action": "Open"
          }
        ]
      },
      {
        "title": "Kit & lab status",
        "items": [
          {
            "title": "Arduino kits",
            "detail": "10 of 12 working",
            "action": "Report fault"
          },
          {
            "title": "3D printer",
            "detail": "Filament low",
            "action": "Request"
          }
        ]
      },
      {
        "title": "Mentors for your class",
        "items": [
          {
            "title": "Online mentor for Class 9 drone project",
            "detail": "Fridays 3 pm",
            "action": "Request"
          }
        ]
      },
      {
        "title": "Teacher training",
        "items": [
          {
            "title": "ATL in-charge certification",
            "detail": "6 hours · online",
            "action": "Enrol"
          }
        ]
      },
      {
        "title": "Competitions",
        "items": [
          {
            "title": "RoboCity League district round",
            "detail": "Register school teams",
            "action": "Register"
          }
        ]
      }
    ]
  },
  "SA": {
    "kpis": [
      [
        "412",
        "students joined"
      ],
      [
        "9",
        "teachers active"
      ],
      [
        "68%",
        "lab utilisation"
      ],
      [
        "3",
        "partner offers"
      ]
    ],
    "cards": [
      {
        "title": "Onboarding",
        "items": [
          {
            "title": "Invite students by class list (CSV)",
            "detail": "212 invited · 168 joined",
            "action": "Invite more"
          },
          {
            "title": "Teachers",
            "detail": "9 of 11 joined",
            "action": "Remind"
          }
        ]
      },
      {
        "title": "Partner offers",
        "items": [
          {
            "title": "CSR: 10 kits for Class 8",
            "detail": "Offered by a nearby town company",
            "action": "Review"
          },
          {
            "title": "Trainer visit: drone workshop",
            "detail": "Free pilot",
            "action": "Accept"
          }
        ]
      },
      {
        "title": "Results to share",
        "items": [
          {
            "title": "2 teams in district round",
            "detail": "RoboCity League",
            "action": "Share"
          },
          {
            "title": "15 projects completed",
            "detail": "This term",
            "action": "Report"
          }
        ]
      }
    ]
  },
  "MG": {
    "kpis": [
      [
        "38",
        "schools onboarded"
      ],
      [
        "54%",
        "average lab use"
      ],
      [
        "7",
        "idle labs"
      ],
      [
        "61%",
        "teachers trained"
      ]
    ],
    "cards": [
      {
        "title": "Labs needing attention",
        "items": [
          {
            "title": "Govt High School A",
            "detail": "No sessions in 30 days",
            "action": "Follow up"
          },
          {
            "title": "Govt Upper Primary School B",
            "detail": "Kits faulty",
            "action": "Assign trainer"
          }
        ]
      },
      {
        "title": "Top performing schools",
        "items": [
          {
            "title": "Girls' Residential School C",
            "detail": "92% lab use · 4 teams",
            "action": "View"
          }
        ]
      },
      {
        "title": "Partners & CSR",
        "items": [
          {
            "title": "2 CSR offers waiting",
            "detail": "For 12 schools",
            "action": "Review"
          }
        ]
      }
    ]
  },
  "ME": {
    "kpis": [
      [
        "6",
        "requests waiting"
      ],
      [
        "11",
        "sessions this month"
      ],
      [
        "4.8",
        "average rating"
      ]
    ],
    "cards": [
      {
        "title": "Requests for you",
        "items": [
          {
            "title": "Class 9 team: motor driver not working",
            "detail": "Arduino · your district",
            "action": "Accept"
          },
          {
            "title": "ITI student: PLC basics",
            "detail": "Online",
            "action": "Accept"
          }
        ]
      },
      {
        "title": "Teams before competitions",
        "items": [
          {
            "title": "3 teams want a coach",
            "detail": "RoboCity League",
            "action": "View"
          }
        ]
      }
    ]
  },
  "TR": {
    "kpis": [
      [
        "84",
        "enrolments"
      ],
      [
        "4.5",
        "course rating"
      ],
      [
        "12",
        "school enquiries"
      ]
    ],
    "cards": [
      {
        "title": "School enquiries",
        "items": [
          {
            "title": "Govt High School D",
            "detail": "Drone workshop for 40 students",
            "action": "Respond"
          }
        ]
      },
      {
        "title": "Demand near you",
        "items": [
          {
            "title": "AI basics",
            "detail": "High demand · your district",
            "action": "List a course"
          }
        ]
      }
    ]
  },
  "KS": {
    "kpis": [
      [
        "23",
        "schools using your kits"
      ],
      [
        "5",
        "open fault reports"
      ],
      [
        "4.3",
        "product rating"
      ]
    ],
    "cards": [
      {
        "title": "Demand",
        "items": [
          {
            "title": "Sensor packs",
            "detail": "18 schools short",
            "action": "View"
          }
        ]
      },
      {
        "title": "Fault reports",
        "items": [
          {
            "title": "Motor driver burnt",
            "detail": "2 schools",
            "action": "Respond"
          }
        ]
      }
    ]
  },
  "SP": {
    "kpis": [
      [
        "12",
        "schools funded"
      ],
      [
        "640",
        "students reached"
      ],
      [
        "9",
        "teams competing"
      ]
    ],
    "cards": [
      {
        "title": "Needs to fund",
        "items": [
          {
            "title": "10 kits · Girls' Residential School C",
            "detail": "₹45,000",
            "action": "Fund"
          },
          {
            "title": "Team travel · state round",
            "detail": "₹12,000",
            "action": "Fund"
          }
        ]
      },
      {
        "title": "Your impact",
        "items": [
          {
            "title": "Lab use in funded schools",
            "detail": "+31% this term",
            "action": "Report"
          }
        ]
      }
    ]
  },
  "IP": {
    "kpis": [
      [
        "57",
        "portfolios match your skills"
      ],
      [
        "3",
        "problem statements live"
      ],
      [
        "14",
        "applications"
      ]
    ],
    "cards": [
      {
        "title": "Talent",
        "items": [
          {
            "title": "Embedded systems · 12 students",
            "detail": "Portfolios verified",
            "action": "View"
          }
        ]
      },
      {
        "title": "Your problem statements",
        "items": [
          {
            "title": "Weed-detection robot",
            "detail": "4 teams working",
            "action": "View"
          }
        ]
      }
    ]
  }
};
