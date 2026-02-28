/*
 * JOIGateway — dual-mode binary for the JOI Gateway .app bundle.
 *
 * Mode 1 (default): Watchdog launcher — fork+exec watchdog.sh
 * Mode 2 ("query"): sqlite3 query tool — FDA-safe database reader
 *
 * Since this binary lives inside JOIGateway.app and has FDA granted to the
 * app bundle, it can open TCC-protected files (e.g. Messages/chat.db)
 * directly. The gateway adapter calls this binary for DB queries instead
 * of sqlite3 or node, so no other process needs FDA.
 *
 * Compile:
 *   cc -O2 -o JOIGateway JOIGateway.c -lsqlite3
 */

#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <signal.h>
#include <sys/wait.h>
#include <sqlite3.h>

/* ── Query mode ──────────────────────────────────────────────── */

static void print_json_string(const char *s) {
    putchar('"');
    if (s) {
        for (; *s; s++) {
            switch (*s) {
                case '"':  fputs("\\\"", stdout); break;
                case '\\': fputs("\\\\", stdout); break;
                case '\n': fputs("\\n", stdout);  break;
                case '\r': fputs("\\r", stdout);  break;
                case '\t': fputs("\\t", stdout);  break;
                default:
                    if ((unsigned char)*s < 0x20)
                        fprintf(stdout, "\\u%04x", (unsigned char)*s);
                    else
                        putchar(*s);
            }
        }
    }
    putchar('"');
}

static int run_query(int argc, char *argv[]) {
    int json_mode = 0;
    const char *db_path = NULL;
    const char *sql = NULL;

    for (int i = 0; i < argc; i++) {
        if (strcmp(argv[i], "-readonly") == 0) continue;
        if (strcmp(argv[i], "-json") == 0) { json_mode = 1; continue; }
        if (!db_path) { db_path = argv[i]; continue; }
        if (!sql)     { sql = argv[i]; continue; }
    }

    if (!db_path || !sql) {
        fprintf(stderr, "Usage: JOIGateway query [-readonly] [-json] <db_path> <sql>\n");
        return 1;
    }

    sqlite3 *db;
    int rc = sqlite3_open_v2(db_path, &db, SQLITE_OPEN_READONLY, NULL);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "Error: unable to open database \"%s\": %s\n",
                db_path, sqlite3_errmsg(db));
        sqlite3_close(db);
        return 1;
    }

    sqlite3_stmt *stmt;
    rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "Error: %s\n", sqlite3_errmsg(db));
        sqlite3_close(db);
        return 1;
    }

    int ncols = sqlite3_column_count(stmt);

    if (json_mode) {
        printf("[");
        int first_row = 1;
        while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
            if (!first_row) printf(",");
            printf("{");
            for (int i = 0; i < ncols; i++) {
                if (i > 0) printf(",");
                print_json_string(sqlite3_column_name(stmt, i));
                printf(":");
                int type = sqlite3_column_type(stmt, i);
                if (type == SQLITE_NULL) {
                    printf("null");
                } else if (type == SQLITE_INTEGER) {
                    printf("%lld", sqlite3_column_int64(stmt, i));
                } else if (type == SQLITE_FLOAT) {
                    printf("%g", sqlite3_column_double(stmt, i));
                } else {
                    print_json_string((const char *)sqlite3_column_text(stmt, i));
                }
            }
            printf("}");
            first_row = 0;
        }
        printf("]\n");
    } else {
        while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
            for (int i = 0; i < ncols; i++) {
                if (i > 0) printf("|");
                const char *val = (const char *)sqlite3_column_text(stmt, i);
                printf("%s", val ? val : "");
            }
            printf("\n");
        }
    }

    if (rc != SQLITE_DONE) {
        fprintf(stderr, "Error: %s\n", sqlite3_errmsg(db));
    }

    sqlite3_finalize(stmt);
    sqlite3_close(db);
    return (rc == SQLITE_DONE) ? 0 : 1;
}

/* ── Watchdog launcher mode ──────────────────────────────────── */

static pid_t child_pid = 0;
static void forward_signal(int sig) {
    if (child_pid > 0) kill(child_pid, sig);
}

int main(int argc, char *argv[]) {
    /* Subcommand: query */
    if (argc > 1 && strcmp(argv[1], "query") == 0) {
        return run_query(argc - 2, argv + 2);
    }

    /* Default: watchdog launcher */
    setenv("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", 1);
    chdir("/Users/mm2/dev_mm/joi");

    child_pid = fork();
    if (child_pid == 0) {
        execl("/bin/bash", "bash", "./scripts/watchdog.sh", NULL);
        perror("execl");
        return 1;
    }

    signal(SIGTERM, forward_signal);
    signal(SIGINT, forward_signal);
    signal(SIGHUP, forward_signal);

    int status;
    waitpid(child_pid, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
