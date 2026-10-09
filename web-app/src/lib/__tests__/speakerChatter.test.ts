import { describe, it, expect } from 'vitest'
import { chatterReason } from '../speakerChatter'

describe('chatterReason', () => {
  // Skipped by the judge on 07 Oct; now dropped without a judge call
  it.each([
    'Okay.',
    'Okay, okay, so...',
    'Yeah. Yes, yes, yes. Correct, correct.',
    'Uh-huh.',
    'Hmm.',
    'Hold on.',
    'Anything else?',
    'Can you hear me? Hello?',
    'Yeah, are you able to hear me?',
    'Hello. Can you hear me now?',
    'You can stop sharing the screen. You can stop sharing the screen.',
    'Thanks. It was nice talking to you. Bye.',
    'చరిత్ర ఎప్పుడు ఓపెన్ అయితది అంటే దాని మీద రక్తం పడ్డప్పుడు.',
  ])('drops %j', (text) => {
    expect(chatterReason(text)).not.toBeNull()
  })

  // Real questions from the same interviews, including short follow-ups
  it.each([
    'Why?',
    'How?',
    'And then?',
    'And both?',
    'Is that right even for a private subnet?',
    'Okay. So, what is the difference between Scenario and Scenario Outline?',
    'Okay, okay. Okay, fine. Can you write that?',
    'Can you share your screen and reverse a string in Python?',
    'Okay. So...  how do you pass runtime arguments?',
    'Hello, Shravani. okay. so which framework are you currently working on?',
    'Dinner చేసేదా, Can you tell me about Kubernetes pods and services?',
  ])('leaves %j to the judge', (text) => {
    expect(chatterReason(text)).toBeNull()
  })
})
