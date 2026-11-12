// Gradle init script: resolve Maven Central through Google's mirror.
// The sandbox proxy intermittently answers repo.maven.apache.org with
// 429 Too Many Requests; the mirror serves the same artifacts.
//   gradle -I scripts/gradle-central-mirror.init.gradle.kts build
val central = "https://repo.maven.apache.org/maven2"
val mirror = "https://maven-central.storage-download.googleapis.com/maven2"
fun fix(r: RepositoryHandler) = r.configureEach {
    if (this is MavenArtifactRepository && (url.toString().trimEnd('/') == central || url.toString().contains("repo.maven.apache.org") || url.toString().contains("repo1.maven.org"))) setUrl(mirror)
}
settingsEvaluated {
    fix(pluginManagement.repositories)
    fix(dependencyResolutionManagement.repositories)
}
allprojects {
    fix(buildscript.repositories)
    fix(repositories)
}
