// vars/aiAutofix.groovy  -  AI analysis INSIDE the failed build.
//
// Usage in the standard pipeline template:
//     post { failure { aiAutofix() } }
//
// Right after a failure it starts a small Python pod, runs the AI flow
// (agent -> validate -> PR), streams everything into THIS build's console,
// archives the results on THIS build and puts the PR link in the build description.
// The build stays FAILED; any problem in the AI part is only echoed, never thrown.
//
// Library layout:
//   vars/aiAutofix.groovy
//   resources/ai/run.py, agent.py, validate.py, create_pr.py, LLM_CIB_CLIENT.py,
//                requirements.txt, pod.yaml
//
// Credentials (create once in Operations Center, shared to all controllers):
//   llm-cib-consumer            username/password  (consumer key / secret)
//   llm-cib-client-cert         secret file        (TLS client certificate)
//   llm-cib-client-key          secret file        (TLS client key)
//   bitbucket-ai-autofix-token  secret text        (service account HTTP token)
//
// The standard library must be a global trusted library (rawBuild access).

import groovy.json.JsonSlurperClassic
import groovy.transform.Field

@Field static final Map DEFAULTS = [
    bitbucketUrl    : 'https://CHANGE-ME-bitbucket',
    sharedLibProject: 'CHANGE-ME',          // project key of this shared library repo
    sharedLibRepo   : 'CHANGE-ME',          // slug of this shared library repo
    libraryName     : 'standard-library',   // name the library is registered under in Jenkins
    allowedRepos    : 'PAY/payments-api',   // pilot allow-list, comma separated, wildcards: PAY/*
    dryRun          : true,                 // true = analyse + validate, no PR
    model           : 'gpt-oss-120b-ITG',
    installDeps     : true,                 // false if pod.yaml uses an image with deps preinstalled
    pipIndexUrl     : '',                   // internal PyPI mirror, if needed
    timeoutMinutes  : 15,
    logLines        : 200,
]

@Field static final List TOOL_FILES = [
    'run.py', 'agent.py', 'validate.py', 'create_pr.py', 'LLM_CIB_CLIENT.py', 'requirements.txt',
]

def call(Map userCfg = [:]) {
    Map cfg = DEFAULTS + userCfg
    if (cfg.enabled == false) {
        return
    }
    try {
        Map facts = collectFacts(cfg)
        if (!facts) {
            return
        }
        if (!isAllowed(facts.REPO_URL, cfg.allowedRepos)) {
            echo "ai-autofix: ${repoName(facts.REPO_URL)} is not in the pilot list, skipping"
            return
        }

        // take the log tail now, so it ends with the failure and not with pod start-up lines
        String tail = logTail(cfg.logLines as int)

        echo '======================== AI autofix (LLM@CIB) ========================'
        Map summary = null
        timeout(time: cfg.timeoutMinutes as int, unit: 'MINUTES') {
            podTemplate(yaml: libraryResource('ai/pod.yaml')) {
                node(POD_LABEL) {
                    container('python') {
                        TOOL_FILES.each { writeFile file: "ai/${it}", text: libraryResource("ai/${it}") }
                        writeFile file: 'ai/console_tail.log', text: tail

                        List envVars = facts.collect { k, v -> "${k}=${v}".toString() } + [
                            "LOG_TAIL_FILE=${pwd()}/ai/console_tail.log",
                            "DRY_RUN=${cfg.dryRun}",
                            "ALLOWED_REPOS=${cfg.allowedRepos}",
                            "BITBUCKET_URL=${cfg.bitbucketUrl}",
                            "SHARED_LIB_PROJECT=${cfg.sharedLibProject}",
                            "SHARED_LIB_REPO=${cfg.sharedLibRepo}",
                            "LLM_CIB_MODEL=${cfg.model}",
                            "PIP_INDEX_URL=${cfg.pipIndexUrl}",
                        ]

                        withCredentials([
                            usernamePassword(credentialsId: 'llm-cib-consumer',
                                             usernameVariable: 'LLM_CIB_CONSUMER_KEY',
                                             passwordVariable: 'LLM_CIB_CONSUMER_SECRET'),
                            file(credentialsId: 'llm-cib-client-cert', variable: 'LLM_CIB_CLIENT_CERT'),
                            file(credentialsId: 'llm-cib-client-key',  variable: 'LLM_CIB_CLIENT_KEY'),
                            string(credentialsId: 'bitbucket-ai-autofix-token', variable: 'BITBUCKET_TOKEN'),
                        ]) {
                            withEnv(envVars) {
                                String install = cfg.installDeps ?
                                    'pip install --quiet --disable-pip-version-check -r requirements.txt && ' : ''
                                sh(script: "cd ai && ${install}python -u run.py", returnStatus: true)
                            }
                        }

                        archiveArtifacts artifacts: 'ai/work/summary.json, ai/work/agent-output/**',
                                         allowEmptyArchive: true
                        if (fileExists('ai/work/summary.json')) {
                            summary = parseJson(readFile('ai/work/summary.json'))
                        }
                    }
                }
            }
        }
        report(summary)
    } catch (Throwable e) {
        echo "ai-autofix: skipped (${e.class.simpleName}: ${e.message})"
    }
}

// ------------------------------------------------------------------ helpers

private Map collectFacts(Map cfg) {
    // PR builds: fix the source branch, not the PR-123 pseudo branch
    String branch = env.CHANGE_BRANCH ?: env.BRANCH_NAME ?:
            (env.GIT_BRANCH ?: '').replaceFirst(/^(origin\/|refs\/heads\/)/, '')
    String repoUrl = env.GIT_URL ?: scmUrl()
    String commit = env.GIT_COMMIT

    if (!branch || !repoUrl || !commit) {
        echo 'ai-autofix: no git information on this build, skipping'
        return null
    }
    if (branch.startsWith('ai/fix-')) {
        echo 'ai-autofix: build of an AI fix branch, skipping'
        return null
    }
    return [
        REPO_URL           : repoUrl,
        BRANCH             : branch,
        COMMIT             : commit,
        SOURCE_BUILD_URL   : env.BUILD_URL ?: '',
        SOURCE_BUILD_NUMBER: env.BUILD_NUMBER ?: '0',
        LIBRARY_VERSION    : libraryVersion(cfg.libraryName as String),
    ]
}

private void report(Map s) {
    if (!s) {
        echo 'ai-autofix: no result produced (see the console above)'
        return
    }
    Map messages = [
        pr_created          : "AI fix PR: ${s.pr_url}",
        dry_run_ok          : 'AI found a fix (dry run, no PR) - see archived ai/work/agent-output/fix.diff',
        not_fixable         : 'AI: not a pipeline configuration problem',
        rejected_validation : 'AI: proposed fix rejected by validation',
        pr_not_created      : 'AI: fix validated but PR not created (see console)',
    ]
    String msg = messages[s.status] ?: "AI: ${s.status}"
    echo "ai-autofix: ${msg}"
    if (s.reason) {
        echo "ai-autofix: root cause: ${s.reason}"
    }
    currentBuild.description = ((currentBuild.description ?: '') + '\n' + msg).trim()
}

private boolean isAllowed(String repoUrl, String patterns) {
    String name = repoName(repoUrl).toLowerCase()
    return (patterns ?: '').split(',')*.trim().findAll { it }.any { p ->
        name ==~ ('\\Q' + p.toLowerCase().replace('*', '\\E.*\\Q') + '\\E')
    }
}

// https://host/scm/pay/payments-api.git -> PAY/payments-api
private String repoName(String url) {
    def m = (url =~ /\/([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/)
    if (!m.find()) {
        return url
    }
    String project = m.group(1)
    return (project.startsWith('~') ? project : project.toUpperCase()) + '/' + m.group(2)
}

private String scmUrl() {
    try {
        return scm.userRemoteConfigs[0].url
    } catch (ignored) {
        return null
    }
}

@NonCPS
private String logTail(int lines) {
    return currentBuild.rawBuild.getLog(lines).join('\n')
}

@NonCPS
private String libraryVersion(String name) {
    def action = currentBuild.rawBuild.getAction(org.jenkinsci.plugins.workflow.libs.LibrariesAction)
    def lib = action?.libraries?.find { it.name == name }
    return lib?.version ?: 'main'
}

@NonCPS
private Map parseJson(String text) {
    return new JsonSlurperClassic().parseText(text) as Map
}
