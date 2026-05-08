#ifndef SQLITE_VEC_H
#define SQLITE_VEC_H

#ifndef SQLITE_CORE
#include "sqlite3ext.h"
#else
#include "sqlite3.h"
#endif

#ifdef SQLITE_VEC_STATIC
  #define SQLITE_VEC_API
#else
  #ifdef _WIN32
    #define SQLITE_VEC_API __declspec(dllexport)
  #else
    #define SQLITE_VEC_API
  #endif
#endif

#define SQLITE_VEC_VERSION "v0.1.10-alpha.3"
// TODO rm
#define SQLITE_VEC_DATE "2026-04-01T06:39:47Z+0000"
#define SQLITE_VEC_SOURCE "4e2dfcb79dcb961bdbaca11dfc91b5bfb9de4fd3"


#define SQLITE_VEC_VERSION_MAJOR 0
#define SQLITE_VEC_VERSION_MINOR 1
#define SQLITE_VEC_VERSION_PATCH 10

#ifdef __cplusplus
extern "C" {
#endif

SQLITE_VEC_API int sqlite3_vec_init(sqlite3 *db, char **pzErrMsg,
                  const sqlite3_api_routines *pApi);

#ifdef __cplusplus
}  /* end of the 'extern "C"' block */
#endif

#endif /* ifndef SQLITE_VEC_H */
