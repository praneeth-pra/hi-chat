import type { RecentClip } from './speakerFilter'

/**
 * Speaker clips from the 7 Oct interviews (13:47 and 16:00 IST), with what
 * should have happened to each, for comparing judge models. "join" means the
 * clip adds to the question just sent: sending it joined, or holding it for
 * the rest, are both right. Transcripts are Grok's first, then ElevenLabs'.
 */
export type JudgeCase = {
  at: string
  texts: string[]
  recent: RecentClip[]
  coding: boolean
  expect: 'send' | 'skip' | 'join'
}

/** Terms those interviews used, standing in for the assistant's list. */
export const JUDGE_CASE_TERMS = [
  'Robot Framework',
  'PyTest',
  'Selenium',
  'Cucumber',
  'Gherkin',
  'REST Assured',
  'TestNG',
  'Extent Reports',
  'Playwright',
  'Maven',
  'Jenkins',
  'kwargs',
  'args',
  'FIX protocol',
  'KYC',
  'Kubernetes',
  'AWS',
  'SQL',
  'Python',
  'Java',
]

export const JUDGE_CASES: JudgeCase[] = [
  {
    at: '08:17:14',
    texts: [
      "Okay. Yeah, sure. let's get started. can you please introduce yourself, shall we?",
      "Okay. Yeah, sure. Let's get started. Can you please introduce yourself, Shauni?",
    ],
    recent: [],
    coding: false,
    expect: 'send',
  },
  {
    at: '08:18:59',
    texts: ['Fine, like overall total experience is six, six years, right?'],
    recent: [
      {
        text: "Okay. Yeah, sure. let's get started. can you please introduce yourself, shall we?",
        sent: true,
        ago: 105,
      },
      {
        text: 'Okay.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '08:19:08',
    texts: ['Okay. So can you please explain me about your last project?'],
    recent: [
      {
        text: "Okay. Yeah, sure. let's get started. can you please introduce yourself, shall we?",
        sent: true,
        ago: 114,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'Fine, like overall total experience is six, six years, right?',
        sent: false,
      },
      {
        text: "It's six years. Okay",
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '08:22:44',
    texts: [
      'Right. In the last project the application where, where the deployment was being done,',
      'Right. In the last project, the application where the deployment was being done.',
    ],
    recent: [
      {
        text: 'What was your role and responsibilities, and what were the skills that are required to',
        sent: false,
      },
      {
        text: 'What was your role and responsibilities, and what were the skills that are required to Perform that testing in that project.',
        sent: true,
        ago: 208,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay. So what methodology you guys are using? in software? Agile, okay.',
        sent: true,
        ago: 25,
      },
      {
        text: 'Okay, so',
        sent: false,
      },
      {
        text: 'Okay, so Your application, right, so where were actually the, the things were getting deployed, whether it in on-prem or cloud, where actually the application was deployed?',
        sent: true,
        ago: 11,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '08:23:36',
    texts: [
      'Okay, so you were using AWS, API exposed in AWS It is deployed in AWS, okay.',
      'Okay, so you were using API exposed in AWS, huh? It is deployed in AWS, okay.',
    ],
    recent: [
      {
        text: 'Okay, so',
        sent: false,
      },
      {
        text: 'Okay, so Your application, right, so where were actually the, the things were getting deployed, whether it in on-prem or cloud, where actually the application was deployed?',
        sent: true,
        ago: 63,
      },
      {
        text: 'Right. In the last project the application where, where the deployment was being done,',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'Yeah, I mean, whether it is in GKE, no, like Kubernetes or whether it was standalone application, what kind of application it was?',
        sent: true,
        ago: 27,
      },
      {
        text: 'Okay.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '08:23:44',
    texts: [
      'Okay, how, how do you debug if any issues with your application in AWS?',
      'Okay. How do you debug if any issues with your application in AWS?',
    ],
    recent: [
      {
        text: 'Okay, so Your application, right, so where were actually the, the things were getting deployed, whether it in on-prem or cloud, where actually the application was deployed?',
        sent: true,
        ago: 71,
      },
      {
        text: 'Right. In the last project the application where, where the deployment was being done,',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'Yeah, I mean, whether it is in GKE, no, like Kubernetes or whether it was standalone application, what kind of application it was?',
        sent: true,
        ago: 35,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'Okay, so you were using AWS, API exposed in AWS It is deployed in AWS, okay.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '08:26:12',
    texts: [
      "True. I don't know, like in bank, have you heard of any something called fixed protocol?",
      "I don't know, like in bank, have you heard of something called fixed protocol?",
    ],
    recent: [
      {
        text: 'Linux experience is there?',
        sent: false,
      },
      {
        text: 'Uh-huh.',
        sent: false,
      },
      {
        text: 'Okay, okay, so...',
        sent: false,
      },
      {
        text: 'Okay, so I, I see like most of the steps you are done through API testing, right? And UI, right?',
        sent: false,
      },
      {
        text: 'Most of your work.',
        sent: false,
      },
      {
        text: 'Most of your work. Is with the UI or in the REST APIs, okay?',
        sent: true,
        ago: 6,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '08:26:56',
    texts: [
      'Yeah, yeah, yeah, yeah, yeah, I understand. Okay, so yeah, most of your data, I think it, you are concerned about the KYC part, right?',
      'Yeah, I understand. Okay. So yeah, most of your data, I think you are concerned about the KYC part, right?',
    ],
    recent: [
      {
        text: 'Most of your work.',
        sent: false,
      },
      {
        text: 'Most of your work. Is with the UI or in the REST APIs, okay?',
        sent: true,
        ago: 50,
      },
      {
        text: "I don't know, like in bank, have you heard of something called fixed protocol?",
        sent: true,
        ago: 44,
      },
      {
        text: 'Can you tell me about Fix Protocol? Yeah.',
        sent: true,
        ago: 36,
      },
      {
        text: 'Uh-huh.',
        sent: false,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '08:30:25',
    texts: [
      'How comfortable you are in SQL? Like out of five, if you want to rate how much you rate yourself?',
      'How comfortable you are in SQL? Like, out of five, if you want to rate, how much you rate yourself?',
    ],
    recent: [
      {
        text: 'Can you tell me some commands, like how do you... Get the status of pods and how do you start them?',
        sent: true,
        ago: 119,
      },
      {
        text: 'Can you tell me some commands, like how do you... Get the status of pods and how do you start them? If you want to delete and restart them, can you tell me about it? Yeah?',
        sent: true,
        ago: 115,
      },
      {
        text: 'Uh-huh.',
        sent: false,
      },
      {
        text: 'Okay, Shawny, fine, okay.',
        sent: false,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'So SQL, have you used any time SQL queries?',
        sent: true,
        ago: 6,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '08:34:38',
    texts: [
      "Let's see. for current position, right, actually, we are actually looking for someone who is good in the Robot Framework side as well.",
      'For current position, right, actually, we are actually looking for someone who is good in the robot framework side as well.',
    ],
    recent: [
      {
        text: 'You can try it.',
        sent: false,
      },
      {
        text: 'You use Pytest, huh?',
        sent: false,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'Okay, okay.',
        sent: false,
      },
      {
        text: 'Fine, Germany. I think, yeah',
        sent: false,
      },
    ],
    coding: true,
    expect: 'skip',
  },
  {
    at: '08:35:12',
    texts: [
      "And not API, REST APIs and all, we don't use REST APIs much as well. Like, it is like, we work on fixed protocols, okay? So, it is completely backend testing we have it. And we required someone who actually knows Robot Framework yeah with Python, actually.",
      "And not API, REST APIs and all. We don't use REST APIs much as well. It is like we work on fixed protocols, okay? So it is completely backend testing we have it. And we required someone who actually knows Robot Framework with Python, actually.",
    ],
    recent: [
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'Okay, okay.',
        sent: false,
      },
      {
        text: 'Fine, Germany. I think, yeah',
        sent: false,
      },
      {
        text: "Let's see. for current position, right, actually, we are actually looking for someone who is good in the Robot Framework side as well.",
        sent: false,
      },
      {
        text: "Okay. And also like we don't have much UI automation, actually. So it is completely backend.",
        sent: false,
      },
    ],
    coding: true,
    expect: 'skip',
  },
  {
    at: '08:35:28',
    texts: [
      'Okay, okay. What kind of testing tool you have used for testing Python, actually?',
      'Okay. What kind of testing tool you have used for testing Python, actually?',
    ],
    recent: [
      {
        text: 'Oh, yeah.',
        sent: false,
      },
      {
        text: 'Yeah.',
        sent: false,
      },
      {
        text: 'Uh-huh.',
        sent: false,
      },
      {
        text: 'Work on this, this. Yeah, yeah, yeah. Mm-hmm. Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay. You...',
        sent: false,
      },
      {
        text: 'Yeah.',
        sent: false,
      },
    ],
    coding: true,
    expect: 'send',
  },
  {
    at: '08:36:18',
    texts: [
      'Okay, okay. Fine, fine, okay. Okay, so I have my colleague Bujama here, okay. So, hi, Bujama. Hello, Madhu. Hi, Shravani. Yeah, I She is our automation resource, okay. So, I think Bujama can you please continue this interview for automation side?',
      'Okay, fine. Okay. So I have my colleague, Poojamma, here. Okay? So, hi, Poojamma. Hello, Madhu. Hi, Shravan. Yeah. She is our automation resource. Okay. So I think, Poojamma, can you please continue this interview for automation side?',
    ],
    recent: [
      {
        text: 'Okay, okay. What kind of testing tool you have used for testing Python, actually?',
        sent: true,
        ago: 50,
      },
      {
        text: 'I mean to write your test cases and running the test, right?',
        sent: false,
      },
      {
        text: 'What kind of tools you have used?',
        sent: false,
      },
      {
        text: 'Test',
        sent: false,
      },
      {
        text: 'VS Code only. Okay, okay, okay. Okay I have',
        sent: false,
      },
      {
        text: 'Uh-huh.',
        sent: false,
      },
    ],
    coding: true,
    expect: 'skip',
  },
  {
    at: '08:37:42',
    texts: [
      "Okay, it's all, then it is a like a form-based, right?",
      'Okay. It is a like a POM-based, right?',
    ],
    recent: [
      {
        text: 'Uh-huh.',
        sent: false,
      },
      {
        text: 'Okay, so what type of framework it is',
        sent: true,
        ago: 65,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: "Okay, so is it like a hybrid with Pom, or it's",
        sent: false,
      },
      {
        text: "Okay, so is it like a hybrid with Pom, or it's Selenium base, I mean, it's a API testing only, right? You have worked on.",
        sent: true,
        ago: 5,
      },
    ],
    coding: true,
    expect: 'skip',
  },
  {
    at: '08:39:19',
    texts: [
      'Maybe you can, yeah, you can take any notepad or online editor or something.',
      'Maybe you can... Yeah, you can take any notepad or online editor or something.',
    ],
    recent: [
      {
        text: 'Okay, step definition files',
        sent: false,
      },
      {
        text: "Okay, then it's a Cucumber framework you are working, or which framework it is exactly?",
        sent: true,
        ago: 42,
      },
      {
        text: 'Test a definition.',
        sent: false,
      },
      {
        text: 'Yeah, correct. We will write all the step definition file for a Cucumber framework, will all the methods we will implement.',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'Oh, yeah, just yeah, just detail, can you explain in detail the framework structure and and can you write a one scenario that you have automated recently?',
        sent: false,
      },
    ],
    coding: true,
    expect: 'skip',
  },
  {
    at: '08:41:02',
    texts: [
      'Okay then fine. So anyhow, we are prefer, we prefer the Robot Framework knowledge more into the other. can you explain the Robot Framework structure and explain in each folder and what is the purpose of each option, like which are available in the framework?',
      'Okay. Then fine. Anyhow, we preferred a robot framework knowledge more into the other. Can you explain the robot framework structure and explain in each folder and what is the purpose of each option, like which available in the framework?',
    ],
    recent: [
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'Oh, yeah, just yeah, just detail, can you explain in detail the framework structure and and can you write a one scenario that you have automated recently?',
        sent: false,
      },
      {
        text: 'Maybe you can, yeah, you can take any notepad or online editor or something.',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'One moment. do you have experience with the Robot Framework?',
        sent: true,
        ago: 41,
      },
      {
        text: 'Have you worked in your previous projects or how it is?',
        sent: true,
        ago: 33,
      },
    ],
    coding: true,
    expect: 'send',
  },
  {
    at: '08:43:11',
    texts: ['The failed test.'],
    recent: [
      {
        text: "Okay, so it's a web-based application you worked or API with the robots framework?",
        sent: true,
        ago: 76,
      },
      {
        text: 'Okay, go ahead.',
        sent: false,
      },
      {
        text: 'What type of reports do you use? Do you guys have any explicit reports or is the built-in reports you are using it?',
        sent: true,
        ago: 23,
      },
      {
        text: "Okay. It's okay. You are use, I mean, generating the HTML reports as a built-in.",
        sent: false,
      },
      {
        text: 'Okay. Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay. Then how do you debug',
        sent: true,
        ago: 1,
      },
    ],
    coding: true,
    expect: 'join',
  },
  {
    at: '08:44:41',
    texts: [
      'Okay. How do you pass a runtime arguments then?',
      'Okay. How do you pass our runtime arguments then?',
    ],
    recent: [
      {
        text: "Okay. It's okay. You are use, I mean, generating the HTML reports as a built-in.",
        sent: false,
      },
      {
        text: 'Okay. Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay. Then how do you debug',
        sent: true,
        ago: 91,
      },
      {
        text: 'The failed test.',
        sent: false,
      },
      {
        text: 'Automatically.',
        sent: false,
      },
      {
        text: 'Okay. how do you run your robot through terminal, like command line? So what is the command that you use to run your tests?',
        sent: true,
        ago: 40,
      },
    ],
    coding: true,
    expect: 'send',
  },
  {
    at: '08:46:33',
    texts: ['With the notepad.'],
    recent: [
      {
        text: 'Suppose you wanted to run your same test with a different value. So how do you pass those runtime arguments?',
        sent: true,
        ago: 104,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'So what are the generic keywords? I mean, is this robot framework, is it data-driven or keyword-driven framework that you worked?',
        sent: true,
        ago: 47,
      },
      {
        text: 'Okay, fine. So can you write one generic keyword that you have added in your project?',
        sent: true,
        ago: 28,
      },
      {
        text: 'Yeah, one generic keyword yeah, can you write a one generic keyword using Robot Framework structure and explain it? you can share.',
        sent: true,
        ago: 2,
      },
    ],
    coding: true,
    expect: 'skip',
  },
  {
    at: '08:55:02',
    texts: ['Is that done, Sh Ronnie?', 'Is that done, Shrani?'],
    recent: [
      {
        text: 'Yeah, okay, fine.',
        sent: false,
      },
      {
        text: 'It has to be a generic.',
        sent: false,
      },
      {
        text: "And I am expecting you to follow the framework structure rules and how, I mean, when you worked on our robot framework, what are the things that you need to take care of, right? I'm expecting you follow the same thing.",
        sent: true,
        ago: 456,
      },
      {
        text: 'Like, when you create a generic keyword, what are the things that it should be taken care when it comes to a generic, right?',
        sent: true,
        ago: 443,
      },
      {
        text: 'Okay, fine. You just write one generic keyword that how you will upload the file, what you said.',
        sent: true,
        ago: 434,
      },
      {
        text: 'No, go ahead.',
        sent: false,
      },
    ],
    coding: true,
    expect: 'skip',
  },
  {
    at: '08:57:01',
    texts: [
      'Then why are you writing this one REST POST I mean dollar REST equals to POST of upload endpoint. So what does that, it will do?',
      'Then why are you writing this one, rest post? I mean, $rest equals to post of upload endpoint. So what does that it will do?',
    ],
    recent: [
      {
        text: 'Is that done, Sh Ronnie?',
        sent: false,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'Is this UI automated scenario or?',
        sent: false,
      },
      {
        text: "Is this UI automated scenario or? Like backend one. I didn't understand the both you have.",
        sent: true,
        ago: 29,
      },
      {
        text: 'Clubbed together.',
        sent: false,
      },
      {
        text: 'So you are uploading, I mean, you are navigating to some one file, and you are getting the file from your local, and upload it to that one, right?',
        sent: false,
      },
    ],
    coding: true,
    expect: 'send',
  },
  {
    at: '08:57:57',
    texts: ['When it comes to the API.'],
    recent: [
      {
        text: 'Then why are you writing this one REST POST I mean $rest equals to POST of upload endpoint. So what does that it will do?',
        sent: true,
        ago: 56,
      },
      {
        text: 'You have submitted here, and the second part, what are you doing here?',
        sent: true,
        ago: 50,
      },
      {
        text: 'Okay, so will it work without any syntactical errors?',
        sent: true,
        ago: 18,
      },
      {
        text: 'If you run.',
        sent: false,
      },
      {
        text: 'If you run.',
        sent: false,
      },
      {
        text: 'So which libraries do you use?',
        sent: true,
        ago: 2,
      },
    ],
    coding: true,
    expect: 'join',
  },
  {
    at: '08:58:38',
    texts: [
      'How do you rate yourself on Python if you say out of five?',
      'How do you rate yourself on Python, if you say out of five?',
    ],
    recent: [
      {
        text: 'If you run.',
        sent: false,
      },
      {
        text: 'If you run.',
        sent: false,
      },
      {
        text: 'So which libraries do you use?',
        sent: true,
        ago: 43,
      },
      {
        text: 'When it comes to the API.',
        sent: false,
      },
      {
        text: 'In a robot framework.',
        sent: false,
      },
      {
        text: 'When it comes to the API. In a robot framework.',
        sent: false,
      },
    ],
    coding: true,
    expect: 'send',
  },
  {
    at: '09:00:14',
    texts: [
      'Okay. Okay, fine. so what is, I mean, the basic, so what is the difference between args and quarks in Python?',
      'Okay, fine. So what is the difference between ARCs and quarks in Python?',
    ],
    recent: [
      {
        text: 'Back in.',
        sent: false,
      },
      {
        text: 'So you worked on a robot on your web, web application, right? Not the backend application.',
        sent: false,
      },
      {
        text: 'Telecom domain. Okay.',
        sent: false,
      },
      {
        text: 'Do you have any exposure on financial domain ever, or have you ever worked on financial domain?',
        sent: true,
        ago: 35,
      },
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
    ],
    coding: true,
    expect: 'send',
  },
  {
    at: '09:02:18',
    texts: [
      'No, no, optional, optional arguments. How do you define optional arguments?',
      'No, no, optional arguments. How do you define optional arguments?',
    ],
    recent: [
      {
        text: 'What you have defined on your keyword or whatever the method you have implemented with the quarks. Okay, so does it optional? I mean, so you should pass a value in your keyword call? Is it mandatory?',
        sent: true,
        ago: 47,
      },
      {
        text: 'When you define a quarks.',
        sent: false,
      },
      {
        text: 'When you define a quarks. How do you define your optional arguments in your keyword',
        sent: true,
        ago: 37,
      },
      {
        text: 'Definition.',
        sent: false,
      },
      {
        text: 'Means, how do you declare or define optional arguments in your keyword definition?',
        sent: true,
        ago: 25,
      },
      {
        text: 'Or method definition, whatever you worked.',
        sent: false,
      },
    ],
    coding: true,
    expect: 'skip',
  },
  {
    at: '09:03:24',
    texts: ['So, is constructor can be a static?'],
    recent: [
      {
        text: 'Definition.',
        sent: false,
      },
      {
        text: 'Means, how do you declare or define optional arguments in your keyword definition?',
        sent: true,
        ago: 91,
      },
      {
        text: 'Or method definition, whatever you worked.',
        sent: false,
      },
      {
        text: 'No, no, optional, optional arguments. How do you define optional arguments?',
        sent: false,
      },
      {
        text: 'Not an issue. what is the default dictionary in Python?',
        sent: true,
        ago: 54,
      },
      {
        text: 'Um...',
        sent: false,
      },
    ],
    coding: true,
    expect: 'send',
  },
  {
    at: '09:05:58',
    texts: ['How?'],
    recent: [
      {
        text: 'Mm-hmm.',
        sent: false,
      },
      {
        text: 'Okay, so what is abstraction, and have you ever used abstraction in your framework?',
        sent: true,
        ago: 101,
      },
      {
        text: 'How?',
        sent: true,
        ago: 95,
      },
      {
        text: 'So, abstract class can be a static or non-static?',
        sent: true,
        ago: 28,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'So, is Python supports multiple inheritance?',
        sent: true,
        ago: 9,
      },
    ],
    coding: true,
    expect: 'send',
  },
  {
    at: '09:08:22',
    texts: ['What is method resolution order in Python?'],
    recent: [
      {
        text: 'What is multiple inheritance? I mean, there are rules, right? The class, I mean, method names should be the same, and the number of arguments should be the same. Then how can you define the method A and B, and then how it will satisfies the multiple inheritance?',
        sent: true,
        ago: 59,
      },
      {
        text: "So that's where the ambiguity will occur, right?",
        sent: false,
      },
      {
        text: 'When it',
        sent: false,
      },
      {
        text: 'Comes to the same method name and with the same arguments, that is',
        sent: false,
      },
      {
        text: 'That is where the ambiguity occurs. So',
        sent: false,
      },
      {
        text: 'The actual rule will persist. Okay, fine. noise shows.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '09:11:24',
    texts: [
      'Okay, do you have any questions, Stravani?',
      'Okay. Do you have any questions, Shravani?',
    ],
    recent: [
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: "Yeah, that's fine.",
        sent: false,
      },
      {
        text: 'What is a namespace in Python?',
        sent: true,
        ago: 79,
      },
      {
        text: 'Can you give me with one example?',
        sent: true,
        ago: 56,
      },
      {
        text: 'Okay. fine.',
        sent: false,
      },
      {
        text: 'Uh...',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:31:10',
    texts: ['Okay, so yeah, how are you?', 'Okay. So, yeah, how are you?'],
    recent: [
      {
        text: 'Yes',
        sent: false,
      },
      {
        text: 'Yes, yes.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:32:55',
    texts: ['Can you open this notepad?', 'Can you open a notepad?'],
    recent: [
      {
        text: 'Yes',
        sent: false,
      },
      {
        text: 'Yes, yes.',
        sent: false,
      },
      {
        text: 'Okay, so yeah, how are you?',
        sent: false,
      },
      {
        text: "Okay, ma'am.",
        sent: false,
      },
      {
        text: 'Yeah, thank you. I saw your resume. It is quite impressive. Just I wanted to see, like as I can see from your resume that you have built a framework from scratch.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:33:28',
    texts: [
      'Just tell me, like, from scratch, if you have to build a framework, right? So can you tell me the, just give me the full test structure, okay? What you are following in your project? Yeah.',
      'Just tell me, from scratch, if you have to build a framework, right? So, just give me the folder structure, okay? What you are following in your project. Yeah.',
    ],
    recent: [
      {
        text: 'Okay, so yeah, how are you?',
        sent: false,
      },
      {
        text: "Okay, ma'am.",
        sent: false,
      },
      {
        text: 'Yeah, thank you. I saw your resume. It is quite impressive. Just I wanted to see, like as I can see from your resume that you have built a framework from scratch.',
        sent: false,
      },
      {
        text: 'Can you open this notepad?',
        sent: false,
      },
      {
        text: 'You can just open normal Notepad, yeah.',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '10:36:39',
    texts: [
      'In Mac, you have TextEdit, I guess, right?',
      'In Mac, you have TextPad, I guess, right?',
    ],
    recent: [
      {
        text: 'Yeah, just open that one, no?',
        sent: false,
      },
      {
        text: 'And',
        sent: false,
      },
      {
        text: "Okay. If you don't have it, I can.",
        sent: false,
      },
      {
        text: 'No problem, you can continue, Abhi. Continue, continue.',
        sent: false,
      },
      {
        text: "And there's always...",
        sent: false,
      },
      {
        text: "And there's always...",
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:42:13',
    texts: ['Have you worked with Selenium Java?'],
    recent: [
      {
        text: "And there's always...",
        sent: false,
      },
      {
        text: "And there's always...",
        sent: false,
      },
      {
        text: 'In Mac, you have TextEdit, I guess, right?',
        sent: false,
      },
      {
        text: 'No problem. Yeah, you can continue.',
        sent: false,
      },
      {
        text: 'Yes.',
        sent: false,
      },
      {
        text: 'So, you have used pytest, right?',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '10:43:10',
    texts: [
      "Yeah, yeah, yeah. Framework I'm talking about or like data-driven hybrid, which one, which one is best?",
      "Yeah, the framework I'm talking about or data-driven, hybrid, which one is this?",
    ],
    recent: [
      {
        text: 'Okay, so the latest project you worked, dealt with is PyTest.',
        sent: false,
      },
      {
        text: 'So, is it with Python with Selenium or how is it? Like, what is the tech?',
        sent: true,
        ago: 30,
      },
      {
        text: "No, no, no, I'm saying, no.",
        sent: false,
      },
      {
        text: 'For pytest testing, are you using Selenium with Python or is it only pytest?',
        sent: true,
        ago: 20,
      },
      {
        text: "What is the framework you're using here?",
        sent: true,
        ago: 15,
      },
      {
        text: 'No, no.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '10:44:26',
    texts: [
      'Where is the test folder here? Like you have written here, test folder, which is there, which is the one? Can you show me? Like, can you take your cursor?',
      'Where is the test folder here? You have written here test folder, which is the one? Can you show me? Can you take your cursor?',
    ],
    recent: [
      {
        text: "Framework I'm talking about or data-driven hybrid, which one is best?",
        sent: true,
        ago: 76,
      },
      {
        text: 'So BDD, are you using here?',
        sent: true,
        ago: 62,
      },
      {
        text: "So where you're writing the feature files?",
        sent: true,
        ago: 58,
      },
      {
        text: 'So in this folder structure where you are like keeping the... this feature files?',
        sent: false,
      },
      {
        text: "So usually, okay, if you have to write this, where usually you'll keep it? Can you show me?",
        sent: true,
        ago: 27,
      },
      {
        text: "So you said like you have dealt with BDD as well, right? Feature files and all those things. So where exactly you'll keep the feature file here?",
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:44:46',
    texts: ["You don't have SRC also, right? Where is the SRC?"],
    recent: [
      {
        text: 'So BDD, are you using here?',
        sent: true,
        ago: 82,
      },
      {
        text: "So where you're writing the feature files?",
        sent: true,
        ago: 78,
      },
      {
        text: 'So in this folder structure where you are like keeping the... this feature files?',
        sent: false,
      },
      {
        text: "So usually, okay, if you have to write this, where usually you'll keep it? Can you show me?",
        sent: true,
        ago: 47,
      },
      {
        text: "So you said like you have dealt with BDD as well, right? Feature files and all those things. So where exactly you'll keep the feature file here?",
        sent: false,
      },
      {
        text: 'Where is the test folder here? Like you have written here, test folder, which is there, which is the one? Can you show me? Like, can you take your cursor?',
        sent: true,
        ago: 20,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:46:01',
    texts: [
      "Okay, got it, got it. okay, no problem. moving on. okay, as you said, you are working with pytest. just give me pytest code where you are checking. I'll just give a simple program, okay? Where you are just, you know, dividing a number with zero and handling the exception. Yeah.",
      "Okay, got it. Okay, no problem. Moving on. Okay, as you said, you are working with PyTest. Just give me a PyTest code where you are checking... I'll just give a simple program, okay? Where you are just dividing a number with zero and handling the exception. Yeah.",
    ],
    recent: [
      {
        text: "So where you're writing the feature files?",
        sent: true,
        ago: 153,
      },
      {
        text: 'So in this folder structure where you are like keeping the... this feature files?',
        sent: false,
      },
      {
        text: "So usually, okay, if you have to write this, where usually you'll keep it? Can you show me?",
        sent: true,
        ago: 122,
      },
      {
        text: "So you said like you have dealt with BDD as well, right? Feature files and all those things. So where exactly you'll keep the feature file here?",
        sent: false,
      },
      {
        text: 'Where is the test folder here? Like you have written here, test folder, which is there, which is the one? Can you show me? Like, can you take your cursor?',
        sent: true,
        ago: 95,
      },
      {
        text: "You don't have SRC also, right? Where is the SRC?",
        sent: true,
        ago: 75,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '10:49:43',
    texts: ['Hello.', 'Hello?'],
    recent: [
      {
        text: "Okay, got it, got it. okay, no problem. moving on. okay, as you said, you are working with pytest. just give me pytest code where you are checking. I'll just give a simple program, okay? Where you are just, you know, dividing a number with zero and handling the exception. Yeah.",
        sent: true,
        ago: 222,
      },
      {
        text: "Okay, this is a simple one. Yeah, two numbers, you're just dividing one number with zero and just handling the exception or how it comes. Okay?",
        sent: false,
      },
      {
        text: 'Byte test.',
        sent: false,
      },
      {
        text: "A simple program, right? Just a simple function you can write, where you are dividing a number by zero, okay? So, it will give exception, correct? So, how you're handling the exception, that's all.",
        sent: true,
        ago: 184,
      },
      {
        text: 'Yeah, this is you are dividing. okay.',
        sent: false,
      },
      {
        text: 'But how are you handling the exception here?',
        sent: true,
        ago: 6,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:51:07',
    texts: ['Can you, can you write that?', 'Can you say it right there?'],
    recent: [
      {
        text: 'Getting the exception.',
        sent: false,
      },
      {
        text: 'One of those keys are at 1.',
        sent: false,
      },
      {
        text: 'Yes, something like that.',
        sent: false,
      },
      {
        text: 'Yeah, something like that, we can. Yeah.',
        sent: false,
      },
      {
        text: "So, what is the block? Like, where exactly you'll write it?",
        sent: true,
        ago: 19,
      },
      {
        text: "It's okay if you are not aware, no problem, okay?",
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:51:38',
    texts: [
      "No problem, no problem. you said you have worked with Java and Selenium, right? Let's look into that once, okay? So, you have worked with Maven?",
      "No problem, no problem. You said you have worked with Java and Selenium, right? Let's look into that once, okay? So you have worked with Maven?",
    ],
    recent: [
      {
        text: "So, what is the block? Like, where exactly you'll write it?",
        sent: true,
        ago: 50,
      },
      {
        text: "It's okay if you are not aware, no problem, okay?",
        sent: false,
      },
      {
        text: 'Can you write that?',
        sent: true,
        ago: 31,
      },
      {
        text: 'Can you write that?',
        sent: false,
      },
      {
        text: "Okay, no, let's move on from this, okay? No problem. I'll not make you uncomfortable. Let's move on from this.",
        sent: false,
      },
      {
        text: 'You said?',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '10:52:13',
    texts: [
      'Just give me a normal syntax of a cucumber, okay? Like from how you start it and how you end it, okay? Normal flow.',
      'Just give me a normal syntax of a Cucumber, okay? Like from how you started and how you ended. Okay? Normal flow.',
    ],
    recent: [
      {
        text: 'Maven and everything, right?',
        sent: false,
      },
      {
        text: 'Okay. so in',
        sent: false,
      },
      {
        text: 'Okay. so in Java Selenium, right? Which framework you had used?',
        sent: true,
        ago: 23,
      },
      {
        text: 'Have you worked with Cucumber?',
        sent: true,
        ago: 15,
      },
      {
        text: 'Cucumber Playwright. Or which one?',
        sent: true,
        ago: 11,
      },
      {
        text: 'Open record now.',
        sent: true,
        ago: 9,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '10:54:44',
    texts: [
      'So, what is the difference between Scenario and Scenario Outline?',
      'So what is the difference between scenario and scenario outline?',
    ],
    recent: [
      {
        text: 'Have you worked with Cucumber?',
        sent: true,
        ago: 166,
      },
      {
        text: 'Cucumber Playwright. Or which one?',
        sent: true,
        ago: 162,
      },
      {
        text: 'Open record now.',
        sent: true,
        ago: 160,
      },
      {
        text: 'Just give me a normal syntax of a Cucumber, okay? Like from how you started and how you ended. Okay? Normal flow.',
        sent: true,
        ago: 151,
      },
      {
        text: "He's gonna be really for a while.",
        sent: false,
      },
      {
        text: 'Okay, okay, okay.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '10:55:39',
    texts: [
      'Are you reporting? Okay. Have you worked with the Stingy?',
      'Are you reporting? Okay. Have you worked with the 10G?',
    ],
    recent: [
      {
        text: 'Okay, okay, okay.',
        sent: false,
      },
      {
        text: 'So, what is the difference between Scenario and Scenario Outline?',
        sent: true,
        ago: 55,
      },
      {
        text: 'All of them.',
        sent: false,
      },
      {
        text: 'Okay.',
        sent: false,
      },
      {
        text: 'And',
        sent: false,
      },
      {
        text: 'Okay, Selenium IDE. So for reporting purpose, what you have used?',
        sent: true,
        ago: 6,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '10:56:49',
    texts: [
      'And before that, I have one doubt. Are you using AI or anything in your mobile?',
    ],
    recent: [
      {
        text: 'Oh, you have worked with REST API Rest Assured?',
        sent: true,
        ago: 44,
      },
      {
        text: 'So...',
        sent: false,
      },
      {
        text: 'Just write a simple code for using REST Assured, okay? In REST Assured also, I think you have used BDD only, right?',
        sent: true,
        ago: 32,
      },
      {
        text: 'So, just write a simple code for fetching a URL, and then you are printing the response.',
        sent: true,
        ago: 25,
      },
      {
        text: 'Yeah, I suppose, yeah.',
        sent: false,
      },
      {
        text: 'And whatever the response is coming, you are printing it. Okay?',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '10:56:54',
    texts: ['Can you show me your mobile, please, once?'],
    recent: [
      {
        text: 'So...',
        sent: false,
      },
      {
        text: 'Just write a simple code for using REST Assured, okay? In REST Assured also, I think you have used BDD only, right?',
        sent: true,
        ago: 37,
      },
      {
        text: 'So, just write a simple code for fetching a URL, and then you are printing the response.',
        sent: true,
        ago: 30,
      },
      {
        text: 'Yeah, I suppose, yeah.',
        sent: false,
      },
      {
        text: 'And whatever the response is coming, you are printing it. Okay?',
        sent: false,
      },
      {
        text: 'And before that, I have one doubt. Are you using AI or anything in your mobile?',
        sent: true,
        ago: 5,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:05:19',
    texts: ['Okay, can you do that now?', 'Okay. Can you do that now?'],
    recent: [
      {
        text: 'Yeah, so...',
        sent: false,
      },
      {
        text: "Here you haven't used. When, right?",
        sent: false,
      },
      {
        text: 'Likely you have used Rest Assured dot get.',
        sent: false,
      },
      {
        text: 'Right? And response will come under which section?',
        sent: true,
        ago: 20,
      },
      {
        text: 'So when is action?',
        sent: false,
      },
      {
        text: 'Right?',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:05:29',
    texts: [
      'Use this, use all these sections and show me.',
      'Use all these sections and show me.',
    ],
    recent: [
      {
        text: 'Right? And response will come under which section?',
        sent: true,
        ago: 30,
      },
      {
        text: 'So when is action?',
        sent: false,
      },
      {
        text: 'Right?',
        sent: false,
      },
      {
        text: 'Okay, can you do that now?',
        sent: true,
        ago: 10,
      },
      {
        text: "Now that you understood, just show me how you'll write it. Like, rewrite this thing, okay?",
        sent: true,
        ago: 7,
      },
      {
        text: 'I want to see all this given when, then, and with it. Okay?',
        sent: true,
        ago: 5,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:08:39',
    texts: [
      "I'm not looking for headers, so no need of header or anything. Just I need the response, okay?",
      "I'm not looking for header, so no need of header or anything. Just I need the response, okay?",
    ],
    recent: [
      {
        text: 'See, if you have any confusion, you can ask me, no problem.',
        sent: false,
      },
      {
        text: 'Yeah.',
        sent: false,
      },
      {
        text: 'Use all the sections, okay? In BDD you have given when then everything, right?',
        sent: false,
      },
      {
        text: 'So you need to use all the sections and rewrite this code.',
        sent: false,
      },
      {
        text: "I'm not.",
        sent: false,
      },
      {
        text: "I'm not looking for header rest.",
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:11:56',
    texts: ['And after that?'],
    recent: [
      {
        text: 'No need of header, you can remove the header and you can continue.',
        sent: false,
      },
      {
        text: 'What are you doing?',
        sent: false,
      },
      {
        text: 'Did you understand what is the question?',
        sent: false,
      },
      {
        text: 'No, okay.',
        sent: false,
      },
      {
        text: 'I, so our basic question was, you have to',
        sent: false,
      },
      {
        text: 'Get the response.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:13:46',
    texts: [
      'Can you write a simple query like you know, third highest number we need to find the third highest salary from my employee table?',
      'Can you write a simple query like third highest number we need to find, the third highest salary from my employee table?',
    ],
    recent: [
      {
        text: 'Okay. So...',
        sent: false,
      },
      {
        text: 'Okay. So...',
        sent: false,
      },
      {
        text: "We don't have much time actually. Only fifteen minutes is there.",
        sent: false,
      },
      {
        text: "No problem. I'll just check. So you have knowledge with SQL?",
        sent: true,
        ago: 14,
      },
      {
        text: 'School details, okay.',
        sent: false,
      },
      {
        text: 'Okay, okay, okay.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '11:15:58',
    texts: [
      'So, what is the application you have used for CI/CD?',
      'So what is the application you have used for CI/CD?',
    ],
    recent: [
      {
        text: 'Third highest salary, karma invited 11.',
        sent: false,
      },
      {
        text: 'Yeah.',
        sent: false,
      },
      {
        text: 'I can see you have worked with Playwright as well.',
        sent: false,
      },
      {
        text: "Have you used Playwright or like it's a... usually just started learning?",
        sent: true,
        ago: 20,
      },
      {
        text: "I'm so ready, I'm so ready.",
        sent: false,
      },
      {
        text: 'Okay you have worked with CSV pipeline, right?',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '11:16:06',
    texts: [
      'So what is the application you have used for CI/CD?',
      'No. So what is the application you have used for CI/CD?',
    ],
    recent: [
      {
        text: 'Yeah.',
        sent: false,
      },
      {
        text: 'I can see you have worked with Playwright as well.',
        sent: false,
      },
      {
        text: "Have you used Playwright or like it's a... usually just started learning?",
        sent: true,
        ago: 28,
      },
      {
        text: "I'm so ready, I'm so ready.",
        sent: false,
      },
      {
        text: 'Okay you have worked with CSV pipeline, right?',
        sent: false,
      },
      {
        text: 'So, what is the application you have used for CI/CD?',
        sent: true,
        ago: 8,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:18:19',
    texts: ['Can you hear me? Hello?', 'Can you give me a number?'],
    recent: [
      {
        text: 'Can you tell me, how do you implement Jenkins along with your project?',
        sent: true,
        ago: 113,
      },
      {
        text: 'Yeah, yeah.',
        sent: false,
      },
      {
        text: 'Okay, and how do you input',
        sent: false,
      },
      {
        text: 'Using against, are you like',
        sent: false,
      },
      {
        text: 'Send updated emails.',
        sent: false,
      },
      {
        text: 'Hello.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:20:23',
    texts: [
      'Yeah, yeah. So I was saying, using, using Jenkins, how you are, how you were, how you are sending automated emails?',
      'Yeah, yeah. So I was saying using Jenkins, how you are sending automated emails?',
    ],
    recent: [
      {
        text: 'Like, when the execution is completed, right, we send automated emails, right?',
        sent: false,
      },
      {
        text: "That's fun. Okay, so I was saying is it... Did you talk? Standard methods. Like, when the execution is completed, right, we send automated emails, right?",
        sent: false,
      },
      {
        text: 'Hold on.',
        sent: false,
      },
      {
        text: 'Uh.',
        sent: false,
      },
      {
        text: 'Hello.',
        sent: false,
      },
      {
        text: 'Can you hear me?',
        sent: false,
      },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '11:21:29',
    texts: [
      'Thanks, I think I am good. sorry, you have anything for me?',
      'Yes, I think I am good, Shravy. You have anything for me?',
    ],
    recent: [
      {
        text: 'Can you hear me?',
        sent: false,
      },
      {
        text: 'Yeah, yeah. So I was saying using Jenkins, how you are sending automated emails?',
        sent: true,
        ago: 66,
      },
      {
        text: 'Yeah, yeah, how you can send automated emails, no?',
        sent: false,
      },
      {
        text: 'Yeah, yeah.',
        sent: false,
      },
      {
        text: 'Yeah.',
        sent: false,
      },
      {
        text: 'Yes, yes, yes.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:22:14',
    texts: [
      'You can, you can stop sharing the screen. You can stop sharing the screen.',
      'You can stop sharing your screen. Can you stop sharing your screen?',
    ],
    recent: [
      {
        text: 'Yeah.',
        sent: false,
      },
      {
        text: 'Yes, yes, yes.',
        sent: false,
      },
      {
        text: 'Thanks, I think I am good. sorry, you have anything for me?',
        sent: true,
        ago: 45,
      },
      {
        text: 'So we are currently using Selenium Java itself, okay? And this role is mostly for API.',
        sent: false,
      },
      {
        text: 'API, sorry, can you hear me? Is it fine now? Network is fine?',
        sent: false,
      },
      {
        text: 'Yeah, IntelliJ IDEA is breaking. I can see that.',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  {
    at: '11:22:50',
    texts: ['What is this? Playwright?'],
    recent: [
      {
        text: 'We are done. Stop sharing your screen, it might.',
        sent: false,
      },
      {
        text: 'Um...',
        sent: false,
      },
      {
        text: 'Help me. The internet. Yeah. Okay. So basically this we are mostly looking for API testers. Okay. This project, project is for',
        sent: false,
      },
      {
        text: 'Yeah, mostly with API testing, and we are mostly working with Selenium.',
        sent: false,
      },
      {
        text: 'Okay, but yeah, there is a future for pytest as well.',
        sent: false,
      },
      {
        text: 'And we might, yeah, and we',
        sent: false,
      },
    ],
    coding: false,
    expect: 'skip',
  },
  // 9 Oct, 12:04 IST: tasks and constraints said as statements were skipped
  {
    at: '9 Oct 12:05:44',
    texts: [
      'I want you to do-perform a shorting over that.',
      'I want you to do, perform a shorting over that.',
    ],
    recent: [
      { text: 'So let us start with a small assessment, okay?', sent: false },
      { text: 'Can you share your screen?', sent: false },
      { text: 'Yes.', sent: false },
      { text: "I've shared a list, basically, in the chat.", sent: false },
    ],
    coding: false,
    expect: 'send',
  },
  {
    at: '9 Oct 12:16:26',
    texts: [
      "Only thing is, like, don't use a third variable.",
      "Only thing is that don't use a third variable.",
    ],
    recent: [
      { text: 'Okay, so this line number 12 is there.', sent: false },
      { text: 'Where you are trying to swap, right?', sent: false },
      { text: 'So I want you to run line number 12.', sent: true, ago: 2 },
    ],
    coding: false,
    expect: 'join',
  },
  {
    at: '9 Oct 12:17:16',
    texts: [
      'Forget about programming, bring the logic.',
      'Forget about programming. There is a logic.',
    ],
    recent: [
      {
        text: 'Swap two variables without using third variable.',
        sent: true,
        ago: 35,
      },
      { text: 'For example, A A is having five.', sent: false },
      { text: 'I wanted to swap the values between those.', sent: false },
      { text: 'Without using any time delay.', sent: false },
      { text: 'Read the logic.', sent: false },
    ],
    coding: false,
    expect: 'send',
  },
]
