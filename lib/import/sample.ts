import type { DocumentSpec } from "./blocks";

// The sample session's material: a short, original guide written for Confu,
// so new students can try everything before uploading their own. The claims
// and numbers come from the studies listed at the end.

export const SAMPLE_TITLE = "How to Learn Anything";

export const SAMPLE: DocumentSpec = {
  kind: "Confu sample",
  title: "How to Learn Anything: A Short Guide to the Science of Learning",
  byline: "Written for Confu · Try highlighting, asking, planning and reviewing here",
  chapters: [
    {
      title: "How to Learn Anything",
      blocks: [
        { t: "p", text: "Most students study the way they were never taught not to: reading the chapter again, highlighting the important lines, and hoping it sticks. This guide explains what decades of memory research say works better, and how to put it into a weekly routine. It is short on purpose. Use it to try Confu: select any sentence to ask about it, build a plan, and let the questions at the end come back to you in spaced review." },

        { t: "h", level: 2, text: "1. Why rereading feels like learning" },
        { t: "p", text: "When you reread a page, the words feel familiar, and that familiarity feels like knowing. Psychologists call it fluency. The trouble is that recognising something when it is in front of you is much easier than recalling it when it is not, and an exam asks for recall." },
        { t: "p", text: "In a large review of ten popular study techniques, Dunlosky and colleagues (2013) rated rereading and highlighting as having low utility: they are easy and comfortable, but they do little for long-term learning. Two techniques were rated as having high utility: practice testing and distributed practice. The next sections explain both." },

        { t: "h", level: 2, text: "2. The forgetting curve" },
        { t: "p", text: "In 1885 Hermann Ebbinghaus memorised lists of nonsense syllables and measured how much effort it took to relearn them after different delays. He called the effort he saved \"savings\". His savings fell quickly at first and then more slowly: after about twenty minutes he had lost roughly 42% of them, after a day about 66%, and after a month about 79%." },
        { t: "p", text: "Forgetting is not a sign that you are bad at learning. It is how memory works for everyone. The shape of the curve is the useful part: most forgetting happens soon after learning, so the first review should come soon, and later reviews can be further apart." },

        { t: "h", level: 2, text: "3. Retrieval practice: test yourself" },
        { t: "p", text: "Pulling information out of memory strengthens it more than putting it in again. This is called the testing effect, or retrieval practice. In a well-known experiment, Roediger and Karpicke (2006) asked students to study short passages. Students who spent part of their time recalling a passage from memory remembered more of it a week later than students who spent the same time rereading it, even though the rereaders expected to do better." },
        { t: "p", text: "Retrieval works because the effort of searching your memory changes what you remember and shows you what you do not know yet. Ways to do it:" },
        { t: "li", text: "Close the book and write down everything you remember about a section." },
        { t: "li", text: "Answer questions before checking the answers, including the ones at the end of a chapter." },
        { t: "li", text: "Explain an idea out loud, as if teaching a friend, without notes." },
        { t: "li", text: "When you get something wrong, check the correct answer straight away, then try again later." },

        { t: "h", level: 2, text: "4. Spacing: let some forgetting happen" },
        { t: "p", text: "Studying the same material in several shorter sessions spread over days (distributed practice) leads to better long-term memory than one long session (massed practice, better known as cramming). A review of hundreds of experiments found this benefit again and again (Cepeda et al., 2006)." },
        { t: "p", text: "How far apart should the sessions be? It depends on how long you need to remember. In a large study, the best gap between two study sessions grew as the test moved further into the future (Cepeda et al., 2008). A practical rule: review the next day, then after a few days, then a week, then a month, giving more time to whatever you missed." },
        { t: "quote", text: "Cramming can get you through tomorrow's test. Spacing gets you through next term." },

        { t: "h", level: 2, text: "5. Interleaving: mix it up" },
        { t: "p", text: "When you practise problems, mixing different types in one session (interleaving) usually leads to better test results than doing all the problems of one type together (blocking). Blocked practice feels easier, because you already know which method to use. Interleaved practice makes you decide which method fits each problem, which is exactly what an exam asks." },
        { t: "p", text: "In one study with maths problems, students who practised in interleaved sets did far better on a test a week later than students who practised the same problems in blocks (Rohrer & Taylor, 2007)." },

        { t: "h", level: 2, text: "6. Elaboration and self-explanation" },
        { t: "p", text: "Asking \"why is this true?\" and \"how does this connect to what I already know?\" is called elaborative interrogation. Explaining each step of a worked example to yourself is called self-explanation. Both help you build connected understanding instead of isolated facts, and Dunlosky et al. (2013) rated both as moderately useful." },
        { t: "p", text: "A good habit: after each paragraph that matters, stop and ask why. If you cannot answer, that is the line to ask about." },

        { t: "h", level: 2, text: "7. Desirable difficulties" },
        { t: "p", text: "Testing yourself, spacing and interleaving have something in common: they feel harder than rereading. Robert Bjork (1994) called these desirable difficulties. They slow you down while you learn, but they make what you learn last longer and transfer better. So when a study session feels effortful, that is often a sign it is working, not that it is failing." },

        { t: "h", level: 2, text: "8. A simple weekly routine" },
        { t: "li", n: 1, text: "Before you read, skim the headings and write one question you want answered." },
        { t: "li", n: 2, text: "Read one section, then close the book and write a three-sentence summary from memory." },
        { t: "li", n: 3, text: "Mark anything you could not recall or did not understand, and ask about it straight away." },
        { t: "li", n: 4, text: "The next day, answer questions on yesterday's material before reading anything new." },
        { t: "li", n: 5, text: "Review again after a few days, a week and a month, spending more time on what you missed." },
        { t: "li", n: 6, text: "When you practise problems, mix topics instead of doing one type at a time." },

        { t: "h", level: 2, text: "9. Check yourself" },
        { t: "p", text: "Answer these from memory before looking back. They are the start of your first spaced review." },
        { t: "li", n: 1, text: "Why can rereading make you feel more confident than you should?" },
        { t: "li", n: 2, text: "What did Ebbinghaus measure, and what shape did his forgetting curve have?" },
        { t: "li", n: 3, text: "What is the testing effect, and how could you use it tonight?" },
        { t: "li", n: 4, text: "Why does spacing beat cramming for long-term memory?" },
        { t: "li", n: 5, text: "What is the difference between interleaved and blocked practice?" },
        { t: "li", n: 6, text: "Give an example of a desirable difficulty from your own studying." },

        { t: "h", level: 2, text: "References" },
        { t: "note", text: "Bjork, R. A. (1994). Memory and metamemory considerations in the training of human beings. In J. Metcalfe & A. Shimamura (Eds.), Metacognition: Knowing about knowing (pp. 185–205). MIT Press." },
        { t: "note", text: "Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. Psychological Bulletin, 132(3), 354–380." },
        { t: "note", text: "Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. Psychological Science, 19(11), 1095–1102." },
        { t: "note", text: "Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques. Psychological Science in the Public Interest, 14(1), 4–58." },
        { t: "note", text: "Ebbinghaus, H. (1885). Über das Gedächtnis. Leipzig: Duncker & Humblot." },
        { t: "note", text: "Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. Psychological Science, 17(3), 249–255." },
        { t: "note", text: "Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. Instructional Science, 35(6), 481–498." },
      ],
    },
  ],
};
